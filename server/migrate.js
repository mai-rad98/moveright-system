const M = require('./models');

// One-off move to "every login is an employee with a role". Safe to run on every start: it only touches old records.
async function migrateRoles(log = console.log) {
  // old login roles: staff -> customer support, payslips-only -> driver
  for (const [old, role] of [['user', 'customer support'], ['employee', 'driver']]) {
    const users = await M.User.find({ role: old }).select('email').lean();
    if (!users.length) continue;
    await M.User.updateMany({ role: old }, { role });
    log(`Roles: ${users.map(u => u.email).join(', ')} moved from "${old}" to "${role}". Check them on the Employees page.`);
  }
  // old employee "System access" -> role (their login's role wins when they have one)
  const access = { admin: 'admin', staff: 'customer support', employee: 'driver', none: 'driver' };
  for (const e of await M.Employee.collection.find({ role: { $exists: false } }).toArray()) {
    const u = e.user && await M.User.findById(e.user).select('role').lean();
    await M.Employee.collection.updateOne({ _id: e._id }, { $set: { role: u ? u.role : access[e.access] || 'driver' }, $unset: { access: '' } });
  }
  // every login gets an employee record (e.g. the first admin); salary 0 keeps them off payroll until it is set
  for (const u of await M.User.find().lean()) {
    if (await M.Employee.exists({ user: u._id })) continue;
    const same = await M.Employee.findOne({ email: u.email, user: null });
    if (same) { await M.Employee.updateOne({ _id: same._id }, { user: u._id, role: u.role }); continue; }
    const [firstName, ...rest] = String(u.name || u.email).trim().split(/\s+/);
    await M.Employee.create({ firstName, surname: rest.join(' ') || '-', email: u.email, role: u.role, salary: 0, user: u._id });
    log(`Employees: added a record for ${u.email} (salary 0, so not on payroll until set)`);
  }
}

module.exports = { migrateRoles };
