import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import type { OutgoingEmail } from './email.js';

/**
 * Sends email through SES on AWS (credentials from the task role), or through a local SMTP
 * catcher (Mailpit) when SMTP_URL is set.
 */
@Injectable()
export class MailerService {
  private readonly smtp?: Transporter;
  private readonly ses?: SESv2Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.mail.smtpUrl) this.smtp = nodemailer.createTransport(config.mail.smtpUrl);
    else this.ses = new SESv2Client({ region: config.mail.region });
  }

  async send(email: OutgoingEmail): Promise<void> {
    const from = this.config.mail.from;
    if (this.smtp) {
      await this.smtp.sendMail({ from, ...email });
      return;
    }
    await this.ses!.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: email.text, Charset: 'UTF-8' },
              Html: { Data: email.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }
}
