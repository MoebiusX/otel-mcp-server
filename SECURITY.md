# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in KrystalineX, please report it responsibly:

1. **Do NOT** create a public GitHub issue
2. Email security concerns to: security@krystaline.io
3. Include detailed steps to reproduce the vulnerability
4. Allow up to 48 hours for initial response

## Security Practices

### Environment Variables

All sensitive configuration is managed through environment variables. **Never commit secrets to version control.**

#### Required Variables (Production)

| Variable | Description | Minimum Requirements |
|----------|-------------|---------------------|
| `JWT_SECRET` | JWT signing key | 32+ characters, no common patterns |
| `DB_PASSWORD` | Database password | 12+ characters |
| `RABBITMQ_PASSWORD` | Message queue password | 8+ characters |
| `KONG_PG_PASSWORD` | Kong database password | 8+ characters |

#### Setup

1. Copy `.env.example` to `.env`
2. Generate secure secrets:
   ```bash
   # Generate JWT secret
   openssl rand -base64 32
   
   # Generate database password
   openssl rand -base64 16
   ```
3. Never use development defaults in production

### Security Validation

The application performs automatic security checks on startup:

- **Development**: Warnings for missing/weak secrets
- **Production**: Fails to start with insecure configuration

### Pre-commit Checks

Run security checks before committing:

```bash
# Check for hardcoded secrets
npm run security:secrets

# Full security check
npm run security:check

# Check dependencies for vulnerabilities
npm run security:audit
```

### Dependency Management

- Run `npm audit` regularly
- Update dependencies with known vulnerabilities promptly
- Use `npm audit fix` for automatic patching when safe

## Security Features

### Authentication
- JWT-based authentication with configurable expiry
- Password hashing with bcrypt (cost factor 12)
- Rate limiting on auth endpoints (60 req/min)
- Session management with secure cookies

### API Security
- Helmet.js for security headers
- CORS with environment-specific origins
- Request timeout middleware
- Input validation with Zod schemas

### Rate Limiting
- General API: 300 requests/minute
- Authentication: 60 requests/minute
- Sensitive operations: 15 requests/minute

## Compliance Checklist

- [ ] All secrets stored in environment variables
- [ ] No hardcoded credentials in codebase
- [ ] `npm audit` passes with no high/critical issues
- [ ] Production uses HTTPS only
- [ ] Database connections use TLS
- [ ] Logs do not contain sensitive data
- [ ] Error messages don't leak internal details

## Updates

This security policy was last updated: February 2026
