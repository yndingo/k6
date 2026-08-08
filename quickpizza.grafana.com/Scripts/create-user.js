import http from 'k6/http';
import { check } from 'k6';

export default function () {
  const url = 'https://quickpizza.grafana.com/api/users';

  const payload = JSON.stringify({
    username: '08.08.2026_3',
    password: '12345678',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(url, payload, params);

  check(response, {
    'пользователь создан — HTTP 201': (r) => r.status === 201,
  });

  console.log(`Статус: ${response.status}`);
  console.log(`Ответ: ${response.body}`);
}