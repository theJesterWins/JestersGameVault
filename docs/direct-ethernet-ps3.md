# Direct Ethernet PS3 FTP Setup

Use this when Wi-Fi FTP works but feels slow or inconsistent. Do not change networks during an active upload.

## Option A: Router or switch wired

This is the easiest wired setup.

1. Plug the PC into the router or network switch with Ethernet.
2. Plug the PS3 into the same router or switch with Ethernet.
3. On the PS3, use normal automatic wired network settings.
4. Find the PS3 IP address under:

   ```text
   Settings -> Network Settings -> Settings and Connection Status List
   ```

5. In Jester's Game Vault, connect to that IP on port `21`.

## Option B: Direct PC-to-PS3 cable

This avoids the router. Most modern PC network adapters support auto-MDI-X, so a normal Ethernet cable is usually fine.

### Windows Ethernet adapter

Set a manual IPv4 address on the Ethernet adapter:

```text
IP address: 192.168.50.1
Subnet mask: 255.255.255.0
Default gateway: blank
DNS: blank
```

Keep Wi-Fi enabled if you still want internet on the PC.

### PS3 wired network

Use Custom wired network settings:

```text
IP address: 192.168.50.2
Subnet mask: 255.255.255.0
Default router/gateway: 192.168.50.1
Primary DNS: 192.168.50.1
Secondary DNS: 8.8.8.8
```

For FTP-only transfers, internet access is not required.

### Jester's Game Vault

Use:

```text
Host: 192.168.50.2
Port: 21
Username: anonymous
Password: blank
```

## Expected result

Wired FTP should be steadier than Wi-Fi. The PS3's own FTP server, internal drive writes, and 20-year-old hardware still limit the top speed, but Ethernet usually removes the worst wireless stalls.

## Good future app upgrades

- Direct Ethernet profile preset.
- FTP speed test that uploads and deletes a small temporary file.
- Resume/retry for interrupted large transfers.
- Transfer history with average MB/s.
