const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Parse htpasswd file
function parseHtpasswd(filePath) {
  const users = new Map();

  if (!fs.existsSync(filePath)) {
    return users;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const [username, hash] = line.split(':');
    if (username && hash) {
      users.set(username.trim(), hash.trim());
    }
  }

  return users;
}

// Verify password against various hash formats
function verifyPassword(password, hash) {
  // Plain text (not recommended but supported)
  if (!hash.startsWith('{') && !hash.startsWith('$')) {
    return password === hash;
  }

  // SHA1 format {SHA}
  if (hash.startsWith('{SHA}')) {
    const base64Hash = hash.substring(5);
    const sha1 = crypto.createHash('sha1').update(password).digest('base64');
    return sha1 === base64Hash;
  }

  // APR1/MD5 format $apr1$
  if (hash.startsWith('$apr1$')) {
    return verifyApr1(password, hash);
  }

  // Bcrypt format $2a$, $2b$, $2y$
  if (hash.startsWith('$2')) {
    const bcrypt = require('bcryptjs');
    return bcrypt.compareSync(password, hash);
  }

  return false;
}

// Verify APR1 MD5 hash
function verifyApr1(password, hash) {
  const parts = hash.split('$');
  if (parts.length < 4) return false;

  const salt = parts[2];
  const generated = apr1Crypt(password, salt);
  return generated === hash;
}

// APR1 MD5 implementation
function apr1Crypt(password, salt) {
  const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function to64(v, n) {
    let result = '';
    while (--n >= 0) {
      result += ITOA64[v & 0x3f];
      v >>= 6;
    }
    return result;
  }

  // Initial hash
  let ctx = crypto.createHash('md5');
  ctx.update(password);
  ctx.update('$apr1$');
  ctx.update(salt);

  let ctx1 = crypto.createHash('md5');
  ctx1.update(password);
  ctx1.update(salt);
  ctx1.update(password);
  let final = ctx1.digest();

  for (let pl = password.length; pl > 0; pl -= 16) {
    ctx.update(final.slice(0, pl > 16 ? 16 : pl));
  }

  for (let i = password.length; i; i >>= 1) {
    if (i & 1) {
      ctx.update(Buffer.from([0]));
    } else {
      ctx.update(password[0]);
    }
  }

  final = ctx.digest();

  // 1000 rounds
  for (let i = 0; i < 1000; i++) {
    ctx1 = crypto.createHash('md5');
    if (i & 1) {
      ctx1.update(password);
    } else {
      ctx1.update(final);
    }
    if (i % 3) {
      ctx1.update(salt);
    }
    if (i % 7) {
      ctx1.update(password);
    }
    if (i & 1) {
      ctx1.update(final);
    } else {
      ctx1.update(password);
    }
    final = ctx1.digest();
  }

  // Final encoding
  let result = '$apr1$' + salt + '$';
  result += to64((final[0] << 16) | (final[6] << 8) | final[12], 4);
  result += to64((final[1] << 16) | (final[7] << 8) | final[13], 4);
  result += to64((final[2] << 16) | (final[8] << 8) | final[14], 4);
  result += to64((final[3] << 16) | (final[9] << 8) | final[15], 4);
  result += to64((final[4] << 16) | (final[10] << 8) | final[5], 4);
  result += to64(final[11], 2);

  return result;
}

// Create basic auth middleware
function basicAuth(htpasswdPath) {
  const usersFile = htpasswdPath || path.join(__dirname, '../../.htpasswd');

  return (req, res, next) => {
    // Check if htpasswd file exists
    if (!fs.existsSync(usersFile)) {
      console.warn('No .htpasswd file found. Admin access is unrestricted.');
      return next();
    }

    const users = parseHtpasswd(usersFile);

    if (users.size === 0) {
      console.warn('Empty .htpasswd file. Admin access is unrestricted.');
      return next();
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
      return res.status(401).send('Authentication required');
    }

    // Decode credentials
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');

    // Verify credentials
    const storedHash = users.get(username);
    if (!storedHash || !verifyPassword(password, storedHash)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
      return res.status(401).send('Invalid credentials');
    }

    // Authentication successful
    req.user = { username };
    next();
  };
}

module.exports = { basicAuth, parseHtpasswd, verifyPassword };
