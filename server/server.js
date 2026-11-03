require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { api, hooks } = require('./routes');
const { User, Interaction, nextRef } = require('./models');

const app = express();
// Allowed website addresses (comma separated in CORS_ORIGIN). Empty = allow all, handy for local testing.
const origins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim().replace(/[/]$/, '')).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/api', api);
app.use('/webhook', hooks);

// Serve the built React app in production (client/dist)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || (err.name === 'ValidationError' || err.code === 11000 ? 400 : 500)).json({ error: err.code === 11000 ? 'That already exists' : err.message });
});

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (!(await User.countDocuments())) {
    await User.create({ name: 'Admin', email: process.env.ADMIN_EMAIL, password: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), role: 'admin' });
    console.log('First admin created:', process.env.ADMIN_EMAIL);
  }
  // Give older Inbox items a ref, oldest first
  for (const d of await Interaction.find({ ref: { $exists: false } }).sort({ receivedAt: 1 }).select('_id'))
    await Interaction.updateOne({ _id: d._id }, { ref: await nextRef() });
  app.listen(process.env.PORT || 5000, () => console.log('MoveRight server running'));
})();