<p align="center">
  <b>НТ для сайта quickpizza.grafana.com</b>
</p>

<b>Действия</b>
1. получение сессионных куки
2. авторизация под пользователями указанных в users.txt
3. попытка авторизации в течении 1 минуты (у сайта стоит стоит защита от перегруза, поэтому при массовой авторизации идет ошибка авторизации, при не успешной авторизации пауза 5 секунд)
4. успешно авторизованные пользователи в течении 1 минуты 10 раз посещают главную страницу
5. каждый успешно авторизованный пользователь ходит на главную VISITS раз
6. все эти визиты равномерно размазываются по VISIT_WINDOW_SEC секунд с помощью динамического пейсинга


<b>Результаты НТ</b>

1. 1 полка нагрузки
2. длительность полки нагрузки 1 минута
3. начало и остановки полки составляет 0 сек (то есть жесткий старт и стоп)
Нагрузка низкая чтобы не заблокировали по айпи из-за ддос

<b>Результаты</b>

Среда выполнения Windows.
Использую встроенный web‑dashboard + HTML‑отчёт.
Windows (PowerShell):
$env:K6_WEB_DASHBOARD = "true"
$env:K6_WEB_DASHBOARD_EXPORT = "report.html"
k6 run script.js

1. 167.92ms среднее время для всех транзакций
2. 207.74ms 95%% для всех транзакций
3. основная проблема идет при авторизации 50% запросов авторизации выдали ошибку, остальные запросы выполнились успешно
4. основное время выполнения идет при авторизации, после авторизации, для других запросов время ответа уменьшается

[Основной отчет сгегенирован K6](Test_Results/report.html)

[Test report. All errors](Test_Results/rambler_errors.xml)

![Aggregate Report](Test_Results/1.aggregate_report.png?raw=true "Title")

Here we can see how many transactions per second are done in lapse of time
![Transactions per second](Test_Results/2.transactions_per_second.png?raw=true "Title")

Here we can see responses in lapse of time
![Response times over time](Test_Results/3.response_times_over_time.png?raw=true "Title")

Here we can see active users in lapse of time
![Active threads over time](Test_Results/4.active_threads_over_time.png?raw=true "Title")
