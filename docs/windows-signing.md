# Windows Signing

Jester's Game Vault signs the packaged Windows beta EXE with `scripts/sign-beta-exe.ps1`. The signing certificate itself is intentionally not stored in this repository.

For broad Windows trust, use an OV or EV code-signing certificate from a trusted certificate authority. A self-signed beta certificate can prove the file was not changed after signing, but it will still show as an unknown or untrusted publisher on other PCs unless that certificate is manually trusted.

## Certificate Environment Variables

For a trusted certificate, set these before running `npm run release:beta`:

```powershell
$env:CSC_LINK="C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
npm run release:beta
```

Do not commit `.pfx`, `.p12`, `.key`, `.pem`, or password files. Those are ignored by `.gitignore` on purpose.

If no certificate is configured, the release script creates or reuses a local self-signed beta code-signing certificate. That gives the EXE an Authenticode signature, but it does not make Windows trust the publisher on other PCs.
