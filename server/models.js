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

// Every login belongs to an employee, and their role decides what they can open.
// Managers (admin, operations manager) see everything; other roles see Dashboard, Inbox, Jobs and their own payslips.
const ROLES = exports.ROLES = ['admin', 'operations manager', 'sales and marketing', 'driver', 'cleaner', 'customer support'];
exports.MANAGERS = ['admin', 'operations manager'];
// Who can read and answer quote requests from the website (Email Quotes)
exports.QUOTE_ROLES = ['admin', 'operations manager', 'customer support', 'sales and marketing'];

exports.User = model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: [...ROLES, 'user', 'employee'], required: true },   // 'user' and 'employee' are old roles, moved over on start-up
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

// Everyone who works here. Each employee has a login with their role; salary 0 = not paid through payroll.
exports.Employee = model('Employee', new Schema({
  firstName: { type: String, required: true, trim: true },
  surname: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: String,
  idNumber: String,                                   // Omang or passport
  jobTitle: String,
  salary: num,                                        // basic monthly pay
  startDate: Date,
  status: { type: String, enum: ['active', 'left'], default: 'active' },
  bankName: String,
  bankAccount: String,
  deductions: [{ name: String, amount: num }],        // recurring each month, e.g. pension, loan
  role: { type: String, enum: ROLES, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, opts));

// CVs, certificates, IDs, contracts… kept apart from the employee so the list stays light
exports.EmployeeDocument = model('EmployeeDocument', new Schema({
  employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  category: { type: String, enum: ['cv', 'certificate', 'id', 'contract', 'other'], default: 'other' },
  data: Buffer, type: String, name: String, size: Number,
}, opts));

// One payroll per month. Drafted on the 28th (or by hand), checked, then finalised by an admin.
exports.PayrollRun = model('PayrollRun', new Schema({
  period: { type: String, required: true, unique: true },   // 'YYYY-MM'
  payDate: Date,
  status: { type: String, enum: ['draft', 'final'], default: 'draft' },
  finalisedAt: Date,
  finalisedBy: by,
  totals: { employees: num, gross: num, paye: num, deductions: num, net: num },
}, opts));

// One payslip per employee per run. Name, job and bank are copied so old payslips never change.
const amounts = [{ name: String, amount: num }];
exports.Payslip = model('Payslip', new Schema({
  run: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
  employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  period: String,
  payDate: Date,
  name: String, jobTitle: String, idNumber: String, email: String, bankName: String, bankAccount: String,
  basic: num,
  allowances: amounts,
  deductions: amounts,                                // other than PAYE
  paye: num,
  payeOverride: { type: Number, default: null },      // set by hand when the worked-out PAYE needs correcting
  gross: num,
  totalDeductions: num,
  net: num,
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
  // Chasing enquiries that were answered but did not become a job
  followUps: [{ at: Date, outcome: { type: String, enum: ['no answer', 'still interested', 'not interested'] }, note: String, by }],
  createdBy: by,
}, opts);
interaction.pre('validate', async function () { if (!this.ref) this.ref = await exports.nextRef(); });
exports.Interaction = model('Interaction', interaction);

// Quote requests from the website. They share the Inbox ref sequence (MR-0042), so a job can point at either.
// Staff answer by email from the support Gmail; customer replies are pulled in from Gmail by mail.js.
const quote = new Schema({
  ref: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: String,
  service: String,
  propertySize: String,
  pickup: String,
  destination: String,
  date: String,                                       // preferred move date as typed on the website (YYYY-MM-DD), may be empty
  message: String,
  status: { type: String, enum: ['new', 'replied', 'customer replied', 'closed'], default: 'new' },
  // The email conversation, oldest first. messageId is how customer replies are matched back to this quote.
  messages: [{
    direction: { type: String, enum: ['out', 'in'] },
    kind: { type: String, enum: ['confirmation', 'reply', 'customer'] },
    subject: String,
    text: String,
    at: { type: Date, default: Date.now },
    by,
    messageId: { type: String, index: true },
  }],
  lastMessageAt: Date,
  emailError: String,                                 // last sending problem, shown to staff
}, opts);
quote.pre('validate', async function () { if (!this.ref) this.ref = await exports.nextRef(); });
exports.Quote = model('Quote', quote);
