#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const htpasswdPath = process.env.HTPASSWD_PATH || path.join(__dirname, '../.htpasswd');

// APR1 MD5 hash generation
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

  function generateSalt() {
    let result = '';
    const chars = ITOA64;
    for (let i = 0; i < 8; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  salt = salt || generateSalt();

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

// Parse existing htpasswd file
function parseHtpasswd() {
  const users = new Map();

  if (fs.existsSync(htpasswdPath)) {
    const content = fs.readFileSync(htpasswdPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const [username, hash] = line.split(':');
      if (username && hash) {
        users.set(username.trim(), hash.trim());
      }
    }
  }

  return users;
}

// Save htpasswd file
function saveHtpasswd(users) {
  const lines = [];
  for (const [username, hash] of users) {
    lines.push(`${username}:${hash}`);
  }
  fs.writeFileSync(htpasswdPath, lines.join('\n') + '\n');
}

// Add or update user
function addUser(username, password) {
  const users = parseHtpasswd();
  const hash = apr1Crypt(password);
  const isUpdate = users.has(username);
  users.set(username, hash);
  saveHtpasswd(users);
  return isUpdate;
}

// Delete user
function deleteUser(username) {
  const users = parseHtpasswd();
  if (users.has(username)) {
    users.delete(username);
    saveHtpasswd(users);
    return true;
  }
  return false;
}

// List users
function listUsers() {
  const users = parseHtpasswd();
  return Array.from(users.keys());
}

// CLI interface
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: node add-user.js <command> [options]

Commands:
  add <username> [password]    Add or update a user (prompts for password if not provided)
  delete <username>            Delete a user
  list                         List all users

Environment:
  HTPASSWD_PATH               Path to htpasswd file (default: .htpasswd)

Examples:
  node add-user.js add admin
  node add-user.js add admin mypassword
  node add-user.js delete admin
  node add-user.js list
`);
  process.exit(0);
}

const command = args[0];

switch (command) {
  case 'add': {
    const username = args[1];
    const password = args[2];

    if (!username) {
      console.error('Error: Username required');
      process.exit(1);
    }

    if (password) {
      const isUpdate = addUser(username, password);
      console.log(isUpdate ? `Updated user: ${username}` : `Added user: ${username}`);
      console.log(`htpasswd file: ${htpasswdPath}`);
    } else {
      // Prompt for password
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      process.stdout.write('Enter password: ');

      // Hide password input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }

      let passwordInput = '';

      process.stdin.on('data', (char) => {
        const c = char.toString();

        if (c === '\n' || c === '\r' || c === '\u0004') {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          console.log();

          if (passwordInput.length < 1) {
            console.error('Error: Password cannot be empty');
            process.exit(1);
          }

          const isUpdate = addUser(username, passwordInput);
          console.log(isUpdate ? `Updated user: ${username}` : `Added user: ${username}`);
          console.log(`htpasswd file: ${htpasswdPath}`);
          process.exit(0);
        } else if (c === '\u0003') {
          // Ctrl+C
          console.log('\nCancelled');
          process.exit(0);
        } else if (c === '\u007F') {
          // Backspace
          if (passwordInput.length > 0) {
            passwordInput = passwordInput.slice(0, -1);
          }
        } else {
          passwordInput += c;
        }
      });
    }
    break;
  }

  case 'delete': {
    const username = args[1];
    if (!username) {
      console.error('Error: Username required');
      process.exit(1);
    }

    if (deleteUser(username)) {
      console.log(`Deleted user: ${username}`);
    } else {
      console.error(`User not found: ${username}`);
      process.exit(1);
    }
    break;
  }

  case 'list': {
    const users = listUsers();
    if (users.length === 0) {
      console.log('No users found');
    } else {
      console.log('Users:');
      users.forEach(u => console.log(`  - ${u}`));
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
