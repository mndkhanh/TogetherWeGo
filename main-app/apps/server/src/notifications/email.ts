import type { Locale } from '@twg/shared';

/** One email, ready to send. Built by the fan-out, sent by the email job. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Everything in an email that came from a user (names, titles, comments) goes through here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header lines can't contain line breaks (header injection), and subjects should be short. */
export function toSubject(text: string): string {
  const line = text.replace(/[\r\n]+/g, ' ').trim();
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

const COPY: Record<
  Locale,
  { hi: string; open: string; textFooter: string; htmlFooter: [string, string] }
> = {
  en: {
    hi: 'Hi',
    open: 'Open in TogetherWeGo',
    textFooter: 'You get this email because of your notification settings:',
    htmlFooter: ['You get this email because of your', 'notification settings'],
  },
  vi: {
    hi: 'Chào',
    open: 'Mở trong TogetherWeGo',
    textFooter: 'Bạn nhận được email này theo cài đặt thông báo của bạn:',
    htmlFooter: ['Bạn nhận được email này theo', 'cài đặt thông báo của bạn'],
  },
};

/** One notification as an email, in the recipient's language. */
export function renderNotificationEmail(input: {
  to: string;
  name: string;
  locale?: Locale;
  text: string;
  /** Absolute URL into the app. */
  url: string;
  settingsUrl: string;
}): OutgoingEmail {
  const { text, url, settingsUrl } = input;
  const copy = COPY[input.locale ?? 'en'];
  return {
    to: input.to,
    subject: toSubject(text),
    text: [
      `${copy.hi} ${input.name},`,
      '',
      text,
      '',
      `${copy.open}: ${url}`,
      '',
      `${copy.textFooter} ${settingsUrl}`,
    ].join('\n'),
    html: `<!doctype html>
<html lang="${input.locale ?? 'en'}"><body style="font-family: system-ui, sans-serif; color: #2b1b15; line-height: 1.5">
  <p>${copy.hi} ${escapeHtml(input.name)},</p>
  <p style="font-size: 16px">${escapeHtml(text)}</p>
  <p><a href="${escapeHtml(url)}" style="color: #c2352a; font-weight: 600">${copy.open}</a></p>
  <p style="color: #73574a; font-size: 13px">${copy.htmlFooter[0]}
    <a href="${escapeHtml(settingsUrl)}" style="color: #73574a">${copy.htmlFooter[1]}</a>.</p>
</body></html>`,
  };
}
