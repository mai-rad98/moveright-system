const { Schema, model } = require('mongoose');
const opts = { timestamps: true };
const num = { type: Number, default: 0 };
const by = { type: Schema.Types.ObjectId, ref: 'User', default: null };   // who entered it (for the Users report)

// Running numbers, e.g. the Inbox ref MR-0001. $inc is atomic, so two people saving at once never get the same ref.
const Counter = exports.Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
exports.nextRef = async () => {
  const c = await Counter.findOneAndUpdate({ _id: 'inbox' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return 'MR-' + String(c.seq).padStart(4, '0');
};

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

// Who does the moves for us. Their prices are kept per location under Prices.
exports.Partner = model('Partner', new Schema({
  name: { type: String, required: true },
  phone: String,
  service: String,
}, opts));

exports.Job = model('Job', new Schema({
  customer: { type: String, required: true },
  phone: String,
  ref: String,                                        // the Inbox enquiry this job came from, e.g. MR-0007
  location: String,                                   // route from the Prices page, e.g. "Gaborone to Ramotswa"
  pickup: String,                                     // older jobs only (before routes were picked from Prices)
  dropoff: String,
  date: { type: Date, default: Date.now },
  status: { type: String, enum: ['quoted', 'confirmed', 'completed', 'cancelled'], default: 'quoted' },
  source: { type: String, enum: ['facebook', 'whatsapp', 'referral', 'other'], default: 'other' },
  routePrice: num,                                    // price of the route
  services: [{                                        // extras on top of the route; name and price copied when added
    service: { type: Schema.Types.ObjectId, ref: 'Service' },
    name: String,
    price: num,
    qty: { type: Number, default: 1 },
  }],
  price: num,                                         // what the customer pays us: route price + services
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
  receipt: { id: Schema.Types.ObjectId, name: String, type: { type: String } },
  createdBy: by,
}, opts));

// Receipt files (PDF or photo), kept apart from expenses so the expense list stays light
exports.Receipt = model('Receipt', new Schema({ data: Buffer, type: String, name: String, size: Number }, opts));

// Every message or comment we receive on Facebook or WhatsApp. Each gets a ref (MR-0001) that jobs link to.
const interaction = new Schema({
  ref: { type: String, unique: true, sparse: true },
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
}, opts);
interaction.pre('validate', async function () { if (!this.ref) this.ref = await exports.nextRef(); });
exports.Interaction = model('Interaction', interaction);
