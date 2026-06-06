# @agenticprimitives/fedcm-rp

## 1.0.0-alpha.6

### Initial (spec 264 Phase 1)

- The RP-side FedCM wrapper: `fedcmSupported()` + `fedcmGet({ providers, ... })` →
  `navigator.credentials.get({ identity })`, post-145 shape (nonce in `params`). `private:true` until a
  live-Chrome verification (Phase 1b). ADR-0031.
