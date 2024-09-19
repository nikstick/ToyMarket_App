# `/api/payment/tbank/init`
`POST`
Создает платеж в системе тбанка. Отдает ссылку, на которую нужно сделать редирект.
## Params
- `orderID`: `int` - номер заказа
## Returns
`JSON`
- `amount`: `int` - сумма платежа (в копейках), которую утвердила платежная система
- `url`: `string` - ссылка на платеж (для редиректа)
- `paymentID`: `int` - номер платежа в системе тбанка (не номер заказа)

# `/api/payment/tbank/cancel`
`POST`
Отменяет платеж в системе тбанка.
## Params
- `paymentID`: `int` - номер платежа в системе тбанка
## Returns
`JSON`
- `orderID`: `int` - номер заказа в спрутоне (так же прописан в платежной системе в виде `OrderId`)

# Возможные ошибки
- Неизвестная ошибка
  code: 500
  body: `Internal Server Error`
- Ошибка от платежной системы
  code: 500
  body: `JSON`
  - `error`: `true`
  - `reason`: `string` - причина ошибки

# Редирект после платежа
После проведения платежа на стороне тбанка идет редирект на `Fail URL`/`Success URL` (задается в личном кабинете платежной системы).
Достаточно отобразить результат платежа пользователю.

## Пример параметров после успешного платежа:
```
https://shop.toyseller.site/fake/success
?Success=true
&ErrorCode=0
&Message=None
&Details=
&Amount=200
&MerchantEmail=sales%40toyseller.site
&MerchantName=ToySeller&OrderId=11203
&PaymentId=5032825895
&TranDate=&BackUrl=https%3A%2F%2Fshop.toyseller.site%2F
&CompanyName=%D0%98%D0%9F+%D0%9A%D0%9E%D0%9D%D0%A2%D0%90%D0%A0%D0%95%D0%92+%D0%95%D0%92%D0%93%D0%95%D0%9D%D0%98%D0%99+%D0%9C%D0%98%D0%A5%D0%90%D0%99%D0%9B%D0%9E%D0%92%D0%98%D0%A7
&EmailReq=sales%40toyseller.site
&PhonesReq=9786121068
```
