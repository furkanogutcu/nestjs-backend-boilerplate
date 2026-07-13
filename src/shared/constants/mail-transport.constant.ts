// * DI token for the active mail transport (an IMailTransport). Lives in shared — a bare token const, no
// * provider/logic — so MailService (and any future consumer) depends only on this token + the interface, never on a
// * concrete driver class. MailModule binds the token to the driver selected by env.MAIL_DRIVER (Resend or Log),
// * which is what keeps swapping/adding a provider a one-line change with no consumer edits.
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
