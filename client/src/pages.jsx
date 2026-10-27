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

// We have no trucks, so a partner does each move: client price = partner price + our markup
export const Locations = ({ admin, period }) => (
  <Crud period={period} title="Locations and prices" endpoint="/locations" canAdd={admin} canEdit={admin} canDelete={admin} fields={[
    { name: 'name', label: 'Location', required: true },
    ...(admin ? [
      { name: 'partner', label: 'Partner', from: 'partners' },
      { name: 'partnerPrice', label: 'Partner price', ...money0, required: true },
      { name: 'markup', label: 'Our markup (P)', ...money0 },
    ] : []),
    { name: 'price', label: 'Client price (full)', ...money0, calc: f => (+f.partnerPrice || 0) + (+f.markup || 0), formHidden: !admin },
    { name: 'notes', label: 'Notes' },
  ]} computed={admin ? [{ label: 'Markup %', fn: r => (r.partnerPrice ? Math.round(r.markup / r.partnerPrice * 1000) / 10 + '%' : '') }] : []} />
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
  ]} />
  )}</Module>
);

// From / To are picked from the locations on the Prices page (the location name is stored)
const location = { from: 'locations', valueKey: 'name', optionLabel: l => `${l.name} (${money(l.price)})` };

export const Jobs = ({ admin }) => (
  <Module title="Jobs" report="jobs" dated>{p => (
  <Crud period={p} title="Jobs" endpoint="/jobs" canDelete={admin} fields={[
    { name: 'customer', label: 'Customer', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'pickup', label: 'From', ...location },
    // Picking the destination fills in its price, and for admins its partner and partner price (all still editable)
    { name: 'dropoff', label: 'To', ...location, onPick: l => ({
      price: l.price,
      ...(admin && { partner: l.partner || '', partnerCost: l.partnerPrice ?? '' }),
    }) },
    { name: 'date', label: 'Move date', type: 'date' },
    { name: 'status', label: 'Status', options: ['quoted', 'confirmed', 'completed', 'cancelled'] },
    { name: 'source', label: 'Source', options: ['facebook', 'whatsapp', 'referral', 'other'] },
    { name: 'price', label: 'Price charged', ...money0 },
    ...(admin ? [
      { name: 'partner', label: 'Partner', from: 'partners' },
      { name: 'partnerCost', label: 'Paid to partner', ...money0 },
      { name: 'share', label: 'Our share', calc: f => (+f.price || 0) - (+f.partnerCost || 0), hideInTable: true },
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
