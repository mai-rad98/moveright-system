import Crud from './Crud.jsx';
import Module from './Module.jsx';
import { api } from './api.js';

// Quote requests from the website. Staff answer by email; it is sent from the support Gmail and the
// customer's replies come back into the conversation automatically (checked every couple of minutes).
const SUPPORT_EMAIL = 'moveright.support@gmail.com';
const STATUS = { new: '#ff6a00', replied: '#2563eb', 'customer replied': '#c0392b', closed: '#64748b' };
const KIND = { confirmation: 'Automatic confirmation', reply: 'Reply', customer: 'Customer' };

const route = r => [r.pickup, r.destination].filter(Boolean).join(' → ');
const when = d => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Move details and the whole email conversation, shown above the reply box
function Conversation(r) {
  const facts = [['Service', [r.service, r.propertySize].filter(Boolean).join(' · ')], ['Route', route(r)], ['Move date', r.date || 'Flexible'],
    ['Notes', r.message], ['Email', r.email], ['Phone', r.phone]].filter(([, v]) => v);
  return (
    <>
      <dl className="quote-facts">{facts.flatMap(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + ':v'}>{v}</dd>])}</dl>
      {r.emailError && <p className="err">Email problem: {r.emailError}</p>}
      <div className="thread">
        {(r.messages || []).map((m, i) => (
          <div key={i} className={'msg ' + m.direction}>
            <small><b>{m.direction === 'in' ? r.name : m.byName || KIND[m.kind]}</b> · {when(m.at)} · {m.subject}</small>
            {m.text}
          </div>
        ))}
        {!r.messages?.length && <p className="muted">No emails yet.</p>}
      </div>
    </>
  );
}

// Keep replies in the same email thread as the confirmation the customer already has
const replySubject = r => {
  const last = [...(r.messages || [])].reverse().find(m => m.subject)?.subject || `Your MoveRight quote [${r.ref}]`;
  return /^re:/i.test(last) ? last : `Re: ${last}`;
};
const setStatus = (r, status) => api(`/quotes/${r._id}/status`, { method: 'POST', body: { status } });

export default function Quotes({ manager }) {
  return (
    <Module title="Email Quotes" report="quotes" dated
      note="Quote requests from the website. Replies are emailed from the support address and the customer's answers appear here automatically.">
      {p => (
        <Crud period={p} title="Quote requests" endpoint="/quotes" canAdd={false} canEdit={false} canDelete={manager}
          searchable="Search ref, name, email or phone" fields={[
            { name: 'ref', label: 'Ref' },
            { name: 'createdAt', label: 'Received', type: 'datetime' },
            { name: 'name', label: 'Name' },
            { name: 'email', label: 'Email' },
            { name: 'phone', label: 'Phone' },
            { name: 'service', label: 'Service' },
            { name: 'date', label: 'Move date', type: 'date' },
            { name: 'status', label: 'Status', colors: STATUS },
          ]} computed={[
            { label: 'Route', fn: route },
            { label: 'Emails', fn: r => (r.messages || []).length },
          ]} actions={[
            { label: 'Reply by email', show: r => r.status !== 'closed', intro: Conversation, submit: 'Send email',
              after: `Sent from ${SUPPORT_EMAIL}. The customer's reply will appear in this conversation.`,
              fields: [
                { name: 'subject', label: 'Subject', wide: true, required: true, initial: replySubject },
                { name: 'message', label: 'Message', type: 'textarea', rows: 11, required: true,
                  initial: r => `Hi ${r.name},\n\nThank you for your quote request.\n\n\n\nKind regards,\nMoveRight Support\n+267 75 822 015` },
              ],
              run: (r, v) => api(`/quotes/${r._id}/reply`, { method: 'POST', body: v }) },
            { label: 'Close', show: r => r.status !== 'closed', run: r => setStatus(r, 'closed') },
            { label: 'Reopen', show: r => r.status === 'closed', run: r => setStatus(r, (r.messages || []).some(m => m.kind === 'reply') ? 'replied' : 'new') },
          ]} />
      )}
    </Module>
  );
}
