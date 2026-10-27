import Crud from './Crud.jsx';
import { api, money } from './api.js';
import Module from './Module.jsx';

const money0 = { type: 'number', money: true };

export const Services = ({ admin, period }) => (
  <Crud period={period} title="Service prices" endpoint="/services" canAdd={admin} canEdit={admin} canDelete={admin} fields={[
    { name: 'name', label: 'Service', required: true },
    { name: 'price', label: 'Price', ...money0, required: true },
    { name: 'unit', label: 'Unit (e.g. per move, per hour)' },
    { name: 'notes', label: 'Notes' },
  ]} />
);

export const Locations = ({ admin, period }) => (
  <Crud period={period} title="Locations and prices" endpoint="/locations" canAdd={admin} canEdit={admin} canDelete={admin} fields={[
    { name: 'name', label: 'Location', required: true },
    { name: 'price', label: 'Price', ...money0, required: true },
    { name: 'notes', label: 'Notes' },
  ]} />
);

export const Prices = ({ admin }) => (
  <Module title="Prices" report="prices" note="The date changes which jobs count towards demand and price realisation; the price lists always show everything.">
    {p => <><Locations admin={admin} period={p} /><Services admin={admin} period={p} /></>}
  </Module>
);

export const Partners = () => (
  <Module title="Partners" report="partners">{p => (
  <Crud period={p} title="Partners" endpoint="/partners" fields={[
    { name: 'name', label: 'Partner', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'service', label: 'Service they provide' },
    { name: 'partnerPrice', label: 'Partner price', ...money0, required: true },
    { name: 'markupPercent', label: 'Our markup %', type: 'number' },
  ]} computed={[
    { label: 'Our markup', fn: r => money((r.partnerPrice || 0) * (r.markupPercent || 0) / 100) },
    { label: 'Customer price', fn: r => money((r.partnerPrice || 0) * (1 + (r.markupPercent || 0) / 100)) },
  ]} />
  )}</Module>
);

export const Jobs = ({ admin }) => (
  <Module title="Jobs" report="jobs" dated>{p => (
  <Crud period={p} title="Jobs" endpoint="/jobs" canDelete={admin} fields={[
    { name: 'customer', label: 'Customer', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'pickup', label: 'From' },
    { name: 'dropoff', label: 'To' },
    { name: 'date', label: 'Move date', type: 'date' },
    { name: 'status', label: 'Status', options: ['quoted', 'confirmed', 'completed', 'cancelled'] },
    { name: 'source', label: 'Source', options: ['facebook', 'whatsapp', 'referral', 'other'] },
    { name: 'price', label: 'Price charged', ...money0 },
    ...(admin ? [
      { name: 'partner', label: 'Partner', from: 'partners' },
      { name: 'partnerCost', label: 'Paid to partner', ...money0 },
    ] : []),
    { name: 'notes', label: 'Notes', hideInTable: true },
  ]} computed={admin ? [{ label: 'Our share', fn: r => money((r.price || 0) - (r.partnerCost || 0)) }] : []} />
  )}</Module>
);

export const Expenses = () => (
  <Module title="Expenses" report="expenses" dated>{p => (
  <Crud period={p} title="Business expenses" endpoint="/expenses" fields={[
    { name: 'title', label: 'Expense', required: true },
    { name: 'category', label: 'Category', options: ['fuel', 'wages', 'vehicle maintenance', 'marketing', 'materials', 'rent', 'other'] },
    { name: 'amount', label: 'Amount', ...money0, required: true },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'notes', label: 'Notes', hideInTable: true },
  ]} />
  )}</Module>
);

export const Inbox = ({ admin }) => (
  <Module title="Inbox" report="inbox" dated>{p => (
  <Crud period={p} title="Inbox: messages and comments" endpoint="/interactions" canDelete={admin} fields={[
    { name: 'receivedAt', label: 'Received', type: 'datetime', required: true },
    { name: 'channel', label: 'Channel', options: ['facebook', 'whatsapp'] },
    { name: 'kind', label: 'Type', options: ['message', 'comment'] },
    { name: 'category', label: 'Category', options: ['price', 'location', 'booking', 'other'] },
    { name: 'from', label: 'From' },
    { name: 'text', label: 'Text' },
    { name: 'responded', label: 'Responded', type: 'checkbox', formHidden: true },
  ]} actions={[{ label: 'Mark responded', show: r => !r.responded, run: r => api('/interactions/' + r._id + '/respond', { method: 'POST' }) }]} />
  )}</Module>
);

export const Users = () => (
  <Module title="Users" report="users" note="The date changes the activity report; the user list always shows everything.">{p => (
  <Crud period={p} title="Users" endpoint="/users" fields={[
    { name: 'name', label: 'Name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'password', label: 'Password', type: 'password', hideInTable: true },
    { name: 'role', label: 'Role', options: ['user', 'admin'] },
  ]} />
  )}</Module>
);
