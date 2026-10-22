# Tailnet access rules (Phase 10)

The plan's rule: only the office computer may reach the gateway phone (SMSGate, port 8080); staff phones and laptops
may reach the office computer's web address only (HTTPS, port 443). Everything else is closed. Tailscale's default
policy lets every device reach every other one, so this has to be set once in the admin console. Only you can do it
(it needs the tailnet admin account).

## 1. Tag the two branch devices

In the Tailscale admin console, Machines:

- the **office computer** (the branch laptop that runs Campus Branch): ⋯ → Edit ACL tags → `tag:office`
- the **gateway phone** (SMSGate): ⋯ → Edit ACL tags → `tag:gateway`

The tags must exist in the policy first, so do step 2 before this, or both in one sitting. A tagged device no longer
belongs to a person and its key does not expire, which suits these two always-on devices.

## 2. Access controls

Admin console → Access controls → replace the policy with this, then Save:

```jsonc
{
  // Who may put these tags on a device: tailnet admins only.
  "tagOwners": {
    "tag:office": ["autogroup:admin"],
    "tag:gateway": ["autogroup:admin"],
  },
  "acls": [
    // Staff phones and laptops (every signed-in person) reach only the office computer's web address.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:office:443"] },
    // Only the office computer reaches the gateway phone's SMSGate Local Server.
    { "action": "accept", "src": ["tag:office"], "dst": ["tag:gateway:8080"] },
  ],
  // The policy checks itself on Save: each test must hold, or the policy is refused.
  "tests": [
    { "src": "tag:office", "accept": ["tag:gateway:8080"], "deny": ["tag:gateway:22"] },
  ],
}
```

If you still reach the test VM or the office computer over SSH from your own laptop, add this line to `acls` while
you need it, and remove it before going live:

```jsonc
    { "action": "accept", "src": ["autogroup:admin"], "dst": ["tag:office:22"] },
```

## Testing setup: remove before go-live

The rules were first applied on 2026-10-21 with test devices standing in (owner's choice). Before the branch goes live:

- [ ] Test VM `win10s`: remove `tag:office` or delete the machine; tag the branch laptop `tag:office` instead.
- [ ] Old laptop running the emulator (if tagged `tag:gateway`): remove it from the tailnet; tag the real phone instead.
- [ ] Delete both admin SSH lines (`tag:office:22`, `tag:gateway:22`) from `acls`.
- [ ] Change the branch router's admin password from the factory one (owner, once the system works; 2026-10-22).

## 3. Check it

| From | Try | Expected |
|---|---|---|
| A staff phone | Open the branch address in the browser | Sign-in page |
| A staff phone | `http://<gateway phone name>:8080/health` in the browser | Does not load |
| The office computer | Settings → SMS gateway | Connected, phone ready |
| The office computer | Send test SMS | Delivered (on the real phone) |
| Your own laptop (not the office computer) | `curl -m 5 http://<gateway phone name>:8080/health` | Times out |

If Settings shows the gateway as unreachable after Save, the gateway phone is probably not tagged `tag:gateway` yet,
or the office computer not `tag:office`.

## The gateway phone on the branch Wi-Fi

SMSGate listens on every network the phone is on, and these rules only cover the tailnet: on Wi-Fi, port 8080 is also
open to the other devices on that Wi-Fi. The owner chose on 2026-10-22 to keep the phone on the branch Wi-Fi: it is
used by staff, customers join it rarely and briefly, and the SMSGate password is never given out. What keeps this safe:

- The SMSGate password stays long and random (24 characters), and stays only in `gateway.json` on the office computer.
- The app reaches the phone by its Tailscale name, so the password and messages never cross the Wi-Fi unencrypted.
- No port forwarding to the phone in the router; the router's admin password is changed from the default.
- If the Wi-Fi is ever opened to customers for good, put the phone on a network with client isolation (a guest
  network with "AP isolation") or on mobile data with Wi-Fi off.
