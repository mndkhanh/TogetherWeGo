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

export function renderNotificationEmail(input: {
  to: string;
  name: string;
  text: string;
  /** Absolute URL into the app. */
  url: string;
  settingsUrl: string;
}): OutgoingEmail {
  const { text, url, settingsUrl } = input;
  return {
    to: input.to,
    subject: toSubject(text),
    text: [
      `Hi ${input.name},`,
      '',
      text,
      '',
      `Open it: ${url}`,
      '',
      `You get this email because of your notification settings: ${settingsUrl}`,
    ].join('\n'),
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #1f2933; line-height: 1.5">
  <p>Hi ${escapeHtml(input.name)},</p>
  <p style="font-size: 16px">${escapeHtml(text)}</p>
  <p><a href="${escapeHtml(url)}" style="color: #2352d1; font-weight: 600">Open in TogetherWeGo</a></p>
  <p style="color: #6b7280; font-size: 13px">You get this email because of your
    <a href="${escapeHtml(settingsUrl)}" style="color: #6b7280">notification settings</a>.</p>
</body></html>`,
  };
}
