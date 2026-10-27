const { Schema, model } = require('mongoose');
const opts = { timestamps: true };
const num = { type: Number, default: 0 };
const by = { type: Schema.Types.ObjectId, ref: 'User', default: null };   // who entered it (for the Users report)

exports.User = model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
}, opts));

// General service prices (e.g. packing assistance, extra labour)
exports.Service = model('Service', new Schema({
  name: { type: String, required: true },
  price: { ...num, required: true },
  unit: String,
  notes: String,
}, opts));

// Price per location: a partner does the move, so client price = partner price + our markup
exports.Location = model('Location', new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  partner: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
  partnerPrice: num,                                  // what the partner charges us
  markup: num,                                        // what we add on top, in Pula
  price: { ...num, required: true },                  // full price quoted to clients
  notes: String,
}, opts));

// What a partner charges us, and our markup on top
exports.Partner = model('Partner', new Schema({
  name: { type: String, required: true },
  phone: String,
  service: String,
  partnerPrice: { ...num, required: true },
  markupPercent: num,
}, opts));

exports.Job = model('Job', new Schema({
  customer: { type: String, required: true },
  phone: String,
  pickup: String,
  dropoff: String,
  date: { type: Date, default: Date.now },
  status: { type: String, enum: ['quoted', 'confirmed', 'completed', 'cancelled'], default: 'quoted' },
  source: { type: String, enum: ['facebook', 'whatsapp', 'referral', 'other'], default: 'other' },
  price: num,                                         // what the customer pays us
  partner: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
  partnerCost: num,                                   // what we pay the partner
  notes: String,
  createdBy: by,
}, opts));

exports.Expense = model('Expense', new Schema({
  title: { type: String, required: true },
  category: { type: String, default: 'other' },
  amount: { ...num, required: true },
  date: { type: Date, default: Date.now },
  notes: String,
  createdBy: by,
}, opts));

// Every message or comment we receive on Facebook or WhatsApp
exports.Interaction = model('Interaction', new Schema({
  channel: { type: String, enum: ['facebook', 'whatsapp'], required: true },
  kind: { type: String, enum: ['message', 'comment'], default: 'message' },
  category: { type: String, enum: ['price', 'location', 'booking', 'other'], default: 'other' },
  from: String,
  fromId: String,
  externalId: String,
  text: String,
  responded: { type: Boolean, default: false },
  respondedAt: Date,
  respondedBy: by,
  receivedAt: { type: Date, default: Date.now },
  createdBy: by,
}, opts));
