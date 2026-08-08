import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// 1. Читаем адрес сайта из файла site.txt
const SITE = open('./site.txt').trim();

// 2. Читаем пользователей из файла users.txt
// формат строки: username password
const users = new SharedArray('users', function () {
  return open('./users.txt')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [username, password] = line.trim().split(/\s+/);
      return { username, password };
    });
});

// 3. Настройки сценария
export const options = {
  scenarios: {
    api: {
      executor: 'per-vu-iterations',
      vus: users.length,
      iterations: 1,
      maxDuration: '3m',
    },
  },
  thresholds: {
    // /api/config должен почти не падать
    'http_req_failed{name:config}': ['rate<0.05'],

    // /api/csrf-token тоже почти без ошибок
    'http_req_failed{name:csrf}': ['rate<0.05'],

    // login допускает больше фейлов (из-за ретраев),
    // но всё равно следим, чтобы не улетало в небеса
    'http_req_failed{name:login}': ['rate<0.5'],

    // главная страница должна быть очень стабильной
    'http_req_failed{name:home}': ['rate<0.05'],
  },
};

// 4. Константы фаз
const AUTH_WINDOW_MS = 60 * 1000; // вся авторизация должна уложиться в 1 минуту
const RETRY_PAUSE_SECONDS = 5;

// сколько раз пользователь посещает главную
const VISITS = 10;
// за какой интервал эти VISITS должны быть выполнены (секунды)
const VISIT_WINDOW_SEC = 60;

export default function () {
  const user = users[(__VU - 1) % users.length];

  const iterationStart = Date.now();

  let loginOk = false;
  let loginRes;
  let sessionJar = null;
  let attempt = 0;

  // 1. Окно авторизации: до 1 минуты с ретраями
  while (Date.now() - iterationStart < AUTH_WINDOW_MS) {
    attempt++;
    console.log(`[${user.username}] === Попытка авторизации #${attempt} ===`);

    // Для каждой попытки — новый чистый CookieJar (новый "браузер")
    const jar = new http.CookieJar();

    // 1.1) /api/config
    let res = http.get(`${SITE}/api/config`, {
      headers: {
        'Accept': '*/*',
        'Origin': SITE,
        'Referer': `${SITE}/login`,
      },
      jar,
      tags: { name: 'config' },
    });

    check(res, {
      [`config 200 (attempt ${attempt}, ${user.username})`]: (r) => r.status === 200,
    });

    let cookies = jar.cookiesForURL(SITE);
    const awsAlb = cookies.AWSALB && cookies.AWSALB[0];
    const awsAlbCors = cookies.AWSALBCORS && cookies.AWSALBCORS[0];

    console.log(
      `[${user.username}] AWSALB после /api/config (попытка ${attempt}): ${
        awsAlb ? awsAlb.substring(0, 20) + '...' : 'нет'
      }`
    );
    console.log(
      `[${user.username}] AWSALBCORS после /api/config (попытка ${attempt}): ${
        awsAlbCors ? awsAlbCors.substring(0, 20) + '...' : 'нет'
      }`
    );

    // 1.2) /api/csrf-token
    res = http.post(`${SITE}/api/csrf-token`, null, {
      headers: {
        'Accept': '*/*',
        'Origin': SITE,
        'Referer': `${SITE}/login`,
      },
      jar,
      tags: { name: 'csrf' },
    });

    check(res, {
      [`csrf 200 (attempt ${attempt}, ${user.username})`]: (r) => r.status === 200,
    });

    cookies = jar.cookiesForURL(SITE);
    const csrfToken = cookies.csrf_token && cookies.csrf_token[0];

    console.log(
      `[${user.username}] csrf_token из куки (попытка ${attempt}): ${
        csrfToken ? csrfToken.substring(0, 10) + '...' : 'НЕ НАЙДЕН'
      }`
    );

    if (!csrfToken) {
      console.log(
        `[${user.username}] csrf_token не найден на попытке ${attempt}, ретраим с новым jar`
      );
      if (Date.now() - iterationStart < AUTH_WINDOW_MS) {
        sleep(RETRY_PAUSE_SECONDS);
      }
      continue;
    }

    // 1.3) login?set_cookie=true
    const loginPayload = JSON.stringify({
      username: user.username,
      password: user.password,
      csrf: csrfToken,
    });

    console.log(
      `[${user.username}] Отправляем login (попытка ${attempt}): ${loginPayload}`
    );

    loginRes = http.post(
      `${SITE}/api/users/token/login?set_cookie=true`,
      loginPayload,
      {
        headers: {
          'content-type': 'application/json',
          'Origin': SITE,
          'Referer': `${SITE}/login`,
          'Accept': '*/*',
        },
        jar,
        tags: { name: 'login' },
      }
    );

    loginOk = loginRes.status === 200;

    check(loginRes, {
      [`login 200 (attempt ${attempt}, ${user.username})`]: (r) => r.status === 200,
    });

    if (loginOk) {
      console.log(
        `[${user.username}] Успешный логин на попытке ${attempt}, статус=${loginRes.status}`
      );
      sessionJar = jar;
      break;
    }

    console.log(
      `[${user.username}] Логин НЕ удался на попытке ${attempt}: статус=${loginRes.status}, тело=${loginRes.body}`
    );

    if (Date.now() - iterationStart < AUTH_WINDOW_MS) {
      console.log(
        `[${user.username}] Пауза ${RETRY_PAUSE_SECONDS} сек перед новой попыткой (новый jar)`
      );
      sleep(RETRY_PAUSE_SECONDS);
    }
  }

  if (!loginOk || !sessionJar) {
    console.log(
      `[${user.username}] Авторизация не удалась в течение отведённой минуты, завершаем сценарий`
    );
    return;
  }

  // 2. Ждём до конца окна авторизации (ровно 1 минута с начала итерации)
  const elapsedMs = Date.now() - iterationStart;
  const remainingMs = AUTH_WINDOW_MS - elapsedMs;

  if (remainingMs > 0) {
    console.log(
      `[${user.username}] Логин успешен раньше минуты, ждём оставшиеся ${Math.round(
        remainingMs / 1000
      )} сек до конца окна авторизации`
    );
    sleep(remainingMs / 1000);
  }

  console.log(
    `[${user.username}] Минута авторизации завершена, начинаем посещения главной страницы`
  );
  console.log(`[${user.username}] Ответ логина: ${loginRes.body}`);

  const finalCookies = sessionJar.cookiesForURL(SITE);
  console.log(
    `[${user.username}] Куки после успешного логина: ${JSON.stringify(finalCookies)}`
  );

  // 3. Фаза посещений главной: VISITS визитов за VISIT_WINDOW_SEC секунд, с динамическим пейсингом
  const visitPhaseStart = Date.now();

  for (let i = 0; i < VISITS; i++) {
    const homeRes = http.get(SITE, {
      headers: {
        'Accept': 'text/html',
      },
      jar: sessionJar,
      tags: { name: 'home' },
    });

    check(homeRes, {
      [`home ${i + 1} 200 (${user.username})`]: (r) => r.status === 200,
    });

    console.log(
      `[${user.username}] Просмотр главной страницы #${i + 1}, статус=${homeRes.status}`
    );

    // целевое накопленное время (мс), к которому этот визит должен уже быть сделан
    const targetElapsedMs = ((i + 1) * VISIT_WINDOW_SEC * 1000) / VISITS;
    const actualElapsedMs = Date.now() - visitPhaseStart;
    const sleepMs = targetElapsedMs - actualElapsedMs;

    if (sleepMs > 0 && i < VISITS - 1) {
      // досыпаем так, чтобы VISITS визитов растянулись примерно на VISIT_WINDOW_SEC секунд
      sleep(sleepMs / 1000);
    }
  }

  console.log(
    `[${user.username}] Завершил ${VISITS} просмотров главной страницы за ~${(
      (Date.now() - visitPhaseStart) /
      1000
    ).toFixed(1)} сек`
  );
}