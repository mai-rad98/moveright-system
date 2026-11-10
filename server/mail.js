// Email for quote requests, sent from and read back from the support Gmail.
// Sending: Gmail SMTP with an App Password (SMTP_USER / SMTP_PASS), so emails really come from the support address
// and a copy lands in its Sent folder. Customer replies: read from the Gmail inbox over IMAP every IMAP_POLL_SECONDS.
const path = require('path');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const M = require('./models');

const SUPPORT_PHONE = '+267 75 822 015';
const env = () => ({ user: (process.env.SMTP_USER || '').trim(), pass: (process.env.SMTP_PASS || '').replace(/\s/g, '') });
const configured = () => { const e = env(); return !!(e.user && e.pass); };

let transport = null;
const transporter = () => transport || (transport = nodemailer.createTransport({ service: 'gmail', auth: env() }));

// ---------- templates ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paras = text => String(text || '').trim().split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

const details = q => [
  ['Reference', q.ref],
  ['Service', [q.service, q.propertySize].filter(Boolean).join(' · ')],
  ['Pickup', q.pickup],
  ['Destination', q.destination],
  ['Preferred date', q.date || 'Flexible'],
  ['Notes', q.message],
  ['Name', q.name],
  ['Email', q.email],
  ['Phone', q.phone],
].filter(([, v]) => v);

const detailsHtml = q => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 18px;font-size:14px">${
  details(q).map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;color:#5b6478;white-space:nowrap;vertical-align:top;border-bottom:1px solid #e3e7f0">${esc(k)}</td><td style="padding:8px 0;color:#0f1530;border-bottom:1px solid #e3e7f0">${esc(v)}</td></tr>`).join('')
}</table>`;
const detailsText = q => details(q).map(([k, v]) => `${k}: ${v}`).join('\n');

// Navy header with the logo, white body, contact footer
const layout = body => `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f1530">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7f0">
<tr><td style="background:#0b1233;padding:18px 24px;border-bottom:3px solid #f47920">
<img src="cid:logo@moveright" width="40" height="40" alt="" style="vertical-align:middle;border-radius:50%;background:#fff">
<span style="vertical-align:middle;margin-left:10px;font-size:18px;font-weight:bold;color:#ffffff">Move<span style="color:#f47920">Right</span></span>
</td></tr>
<tr><td style="padding:26px 24px 10px;font-size:15px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid #e3e7f0;font-size:12px;color:#5b6478;line-height:1.6">
MoveRight Moving &amp; Relocation · Gaborone, Botswana<br>${esc(SUPPORT_PHONE)} · ${esc(env().user)}<br>Simply reply to this email to reach our team.
</td></tr></table></td></tr></table></body></html>`;

const logo = { filename: 'logo.png', path: path.join(__dirname, 'assets', 'logo.png'), cid: 'logo@moveright' };

// Every subject carries [MR-0042]: that is how customer replies find their quote when headers are missing
const withRef = (subject, ref) => (subject.includes(`[${ref}]`) ? subject : `${subject} [${ref}]`);

exports.confirmation = q => ({
  to: q.email,
  subject: `We received your quote request [${q.ref}]`,
  text: `Hi ${q.name},\n\nThanks for choosing MoveRight. We've received your quote request and will send you a clear, itemised quote within one business day.\n\n${detailsText(q)}\n\nNeed something changed? Just reply to this email or call us on ${SUPPORT_PHONE}.\n\nMoveRight Support`,
  html: layout(`<p style="margin:0 0 14px">Hi ${esc(q.name)},</p>
<p style="margin:0 0 14px">Thanks for choosing MoveRight. We've received your quote request and will send you a clear, itemised quote <b>within one business day</b>.</p>
${detailsHtml(q)}
<p style="margin:0 0 14px">Need something changed? Just reply to this email or call us on ${esc(SUPPORT_PHONE)}.</p>
<p style="margin:0 0 14px">MoveRight Support</p>`),
});

// To the support inbox; replying to it in Gmail goes straight to the customer
exports.notification = q => ({
  to: env().user,
  replyTo: q.email,
  subject: `New quote request [${q.ref}] from ${q.name}${q.service ? ` · ${q.service}` : ''}`,
  text: `New quote request from the website.\n\n${detailsText(q)}\n\nAnswer it in the MoveRight system under Email Quotes so the conversation is kept with the quote.`,
  html: layout(`<p style="margin:0 0 14px"><b>New quote request from the website.</b></p>${detailsHtml(q)}
<p style="margin:0 0 14px;color:#5b6478">Answer it in the MoveRight system under <b>Email Quotes</b> so the conversation is kept with the quote.</p>`),
});

exports.reply = (q, subject, message) => ({
  to: q.email,
  subject: withRef(subject || `Your MoveRight quote`, q.ref),
  text: message,
  html: layout(paras(message)),
});

// Send one email from the support address. `thread` is the quote's earlier messages, for In-Reply-To / References.
exports.send = async (mail, thread = []) => {
  if (!configured()) throw new Error('Email is not set up: add SMTP_USER and SMTP_PASS to server/.env');
  const ids = thread.map(m => m.messageId).filter(Boolean);
  const info = await transporter().sendMail({
    from: { name: process.env.MAIL_FROM_NAME || 'MoveRight Support', address: env().user },
    attachments: [logo],
    ...(ids.length && { inReplyTo: ids.at(-1), references: ids }),
    ...mail,
  });
  return info.messageId;
};

// ---------- customer replies (IMAP) ----------
// Keep only the new part of a reply: cut at the quoted history most mail apps add
const stripQuoted = text => {
  const cut = String(text || '').split(/^\s*(?:On .{0,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .*<?\S+@\S+>?)\s*$|^>/im)[0].trim();
  return cut || String(text || '').trim();
};

let polling = false;
// Look at unread inbox emails from the last 14 days; add each one that answers a quote to its conversation.
// Emails that are not about a quote are left unread in Gmail.
exports.pollReplies = async () => {
  if (!configured() || polling) return 0;
  polling = true;
  const { user, pass } = env();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  let added = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = (await client.search({ seen: false, since: new Date(Date.now() - 14 * 86400e3) }, { uid: true })) || [];
      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg?.source) continue;
        const mail = await simpleParser(msg.source);
        const from = mail.from?.value?.[0]?.address?.toLowerCase();
        if (!from || from === user.toLowerCase()) continue;          // our own notifications to the support inbox
        const ids = [mail.inReplyTo, ...[].concat(mail.references || [])].filter(Boolean);
        let q = ids.length ? await M.Quote.findOne({ 'messages.messageId': { $in: ids } }) : null;
        const ref = /\[(MR-\d+)\]/.exec(mail.subject || '')?.[1];
        if (!q && ref) q = await M.Quote.findOne({ ref, email: from });   // headers stripped: match the ref, same sender only
        if (!q) continue;
        if (!q.messages.some(m => mail.messageId && m.messageId === mail.messageId)) {
          q.messages.push({ direction: 'in', kind: 'customer', subject: mail.subject, text: stripQuoted(mail.text), at: mail.date || new Date(), messageId: mail.messageId });
          q.status = 'customer replied';
          q.lastMessageAt = new Date();
          await q.save();
          added++;
        }
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    console.error('Email replies:', e.message);
    client.close();
  } finally { polling = false; }
  return added;
};

exports.configured = configured;
