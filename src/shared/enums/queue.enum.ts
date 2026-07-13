export enum AppQueue {
  SendMail = 'send-mail-queue',
  OutboxRelay = 'outbox-relay-queue',
  OutboxPrune = 'outbox-prune-queue',
  InboxPrune = 'inbox-prune-queue',
}
