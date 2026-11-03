import Crud from './Crud.jsx';
import { api, money } from './api.js';
import Module from './Module.jsx';

const money0 = { type: 'number', money: true };

// Colour codes for pills in the tables
const CHANNEL = { facebook: '#1877f2', whatsapp: '#1a8f4c', referral: '#0f9d8a', other: '#64748b' };
const KIND = { message: '#0a2b5e', comment: '#7c3aed' };
const STATUS = { quoted: '#d97706', confirmed: '#2563eb', completed: '#1a8f4c', cancelled: '#64748b', 'No job yet': '#c0392b' };
const EXPENSE = { fuel: '#ff6a00', wages: '#2563eb', 'vehicle maintenance': '#7c3aed', marketing: '#db2777', materials: '#0f9d8a', rent: '#0a2b5e', other: '#64748b' };

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
  <Crud period={period} title="Routes and prices" endpoint="/locations" canAdd={admin} canEdit={admin} canDelete={admin} fields={[
    { name: 'name', label: 'Route (e.g. Gaborone to Ramotswa)', required: true },
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

// The route is picked from the Prices page (its name is stored, e.g. "Gaborone to Ramotswa")
const location = { from: 'locations', valueKey: 'name', search: true, optionLabel: l => `${l.name} (${money(l.price)})` };

const servicesTotal = f => (f.services || []).reduce((s, x) => s + (x.price || 0) * (+x.qty || 1), 0);

export const Jobs = ({ admin }) => (
  <Module title="Jobs" report="jobs" dated>{p => (
  <Crud period={p} title="Jobs" endpoint="/jobs" canDelete={admin} searchable="Search ref, phone or customer" fields={[
    // Every job starts as an Inbox enquiry: picking its ref fills in the customer, phone (WhatsApp) and source
    { name: 'ref', label: 'Inbox ref', from: 'interactions', valueKey: 'ref', search: true,
      optionLabel: i => [i.ref, i.from, i.channel, i.text && `"${i.text.slice(0, 40)}"`].filter(Boolean).join(' · '),
      onPick: (i, f) => ({
        source: i.channel,
        ...(!f.customer && i.from && { customer: i.from }),
        ...(!f.phone && i.channel === 'whatsapp' && i.fromId && { phone: i.fromId }),
      }) },
    { name: 'customer', label: 'Customer', required: true },
    { name: 'phone', label: 'Phone' },
    // Picking the route fills in its price, and for admins its partner and partner price (all still editable)
    { name: 'location', label: 'Route', ...location, onPick: l => ({
      routePrice: l.price,
      ...(admin && { partner: l.partner || '', partnerCost: l.partnerPrice ?? '' }),
    }) },
    { name: 'routePrice', label: 'Route price', ...money0, hideInTable: true, editValue: r => r.routePrice ?? r.price },
    { name: 'services', label: 'Extra services', type: 'lines', from: 'services' },
    { name: 'price', label: 'Price charged (total)', ...money0, calc: f => (+f.routePrice || 0) + servicesTotal(f) },
    { name: 'date', label: 'Move date', type: 'date' },
    { name: 'status', label: 'Status', options: ['quoted', 'confirmed', 'completed', 'cancelled'], colors: STATUS },
    { name: 'source', label: 'Source', options: ['facebook', 'whatsapp', 'referral', 'other'], colors: CHANNEL },
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
    { name: 'category', label: 'Category', options: Object.keys(EXPENSE), colors: EXPENSE },
    { name: 'amount', label: 'Amount', ...money0, required: true },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'receipt', label: 'Receipt (PDF or photo, max 5 MB)', type: 'file' },
    { name: 'notes', label: 'Notes', hideInTable: true },
  ]} />
  )}</Module>
);

export const Inbox = ({ admin }) => (
  <Module title="Inbox" report="inbox" dated>{p => (
  <Crud period={p} title="Inbox: messages and comments" endpoint="/interactions" canDelete={admin} fields={[
    { name: 'ref', label: 'Ref', readOnly: true },
    { name: 'receivedAt', label: 'Received', type: 'datetime', required: true },
    { name: 'channel', label: 'Channel', options: ['facebook', 'whatsapp'], colors: CHANNEL },
    { name: 'kind', label: 'Type', options: ['message', 'comment'], colors: KIND },
    { name: 'category', label: 'Category', options: ['price', 'location', 'booking', 'other'] },
    { name: 'from', label: 'Name' },
    { name: 'text', label: 'Text' },
    { name: 'responded', label: 'Responded', type: 'checkbox', formHidden: true },
  ]} computed={[{ label: 'Job', fn: r => r.job?.status || 'No job yet', colors: STATUS }]} actions={[{ label: 'Mark responded', show: r => !r.responded, run: r => api('/interactions/' + r._id + '/respond', { method: 'POST' }) }]} />
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
