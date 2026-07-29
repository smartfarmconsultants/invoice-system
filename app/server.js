require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const csurf = require('csurf');
const path = require('path');
const { pool } = require('./db');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const invoiceRoutes = require('./routes/invoices');
const customerRoutes = require('./routes/customers');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// If deploying behind Render's proxy, this makes secure cookies work correctly.
if (isProd) app.set('trust proxy', 1);

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session' }),
    // For MySQL-hosted deployments, swap the above for `express-mysql-session`
    // pointed at the same connection details.
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8 // 8 hour session timeout
    }
  })
);

// CSRF protection on all state-changing form submissions.
app.use(csurf());

app.get('/', (req, res) => res.redirect('/login'));

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(invoiceRoutes);
app.use(customerRoutes);
app.use(userRoutes);

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Form expired or invalid. Please try again.' });
  }
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`Invoice system running on port ${PORT}`));
