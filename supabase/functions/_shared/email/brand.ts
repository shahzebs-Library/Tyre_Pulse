export const BRAND = {
  name: 'Tyre Pulse',
  dark: '#161616',
  yellow: '#FFC629',
  ink: '#161616',
  muted: '#5b5b5b',
  line: '#e6e6e6',
  page: '#f4f4f2',
  site: 'https://tyrepulse.app',
  siteLabel: 'tyrepulse.app',
  playUrl: 'https://play.google.com/store/apps/details?id=com.shahzebrahman.tyrepulse',
  from: 'Tyre Pulse <noreply@tyrepulse.app>',
  replyTo: 'info@tyrepulse.app',
} as const

/** Only these hosts may appear in a link inside an email. */
export const ALLOWED_LINK_HOSTS = ['tyrepulse.app', 'www.tyrepulse.app', 'app.tyrepulse.app', 'play.google.com', 'apps.apple.com']
