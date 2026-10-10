# sign a request to the shwarm api: RFC 9421 with ed25519 (protocol §10).
# needs python 3.8+ and: pip install cryptography
import base64, hashlib, secrets, time
from urllib.parse import urlsplit
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def parse_secret(secret):
    """shwarm_sk_<keyid>_<seed>, as the keys page shows it once. returns (keyid, seed)."""
    s = secret.strip()
    return s[len("shwarm_sk_"):-44], base64.urlsafe_b64decode(s[-43:] + "=")


def sign(method, url, headers, body, keyid, seed, created=None, nonce=None):
    """the content-digest, signature-input and signature headers to add. body is the exact bytes sent."""
    u = urlsplit(url)
    digest = "sha-256=:%s:" % base64.b64encode(hashlib.sha256(body).digest()).decode()
    lower = {k.lower(): v for k, v in headers.items()}
    covered = [("@method", method.upper()), ("@authority", u.netloc.lower()), ("@path", u.path or "/"),
               ("@query", "?" + u.query), ("content-digest", digest)]
    if "idempotency-key" in lower:  # every POST sends one, the same on each retry
        covered.append(("idempotency-key", lower["idempotency-key"]))
    params = '(%s);created=%d;nonce="%s";keyid="%s";alg="ed25519";tag="shwarm"' % (
        " ".join('"%s"' % name for name, _ in covered), created or int(time.time()),
        nonce or secrets.token_urlsafe(16), keyid)
    base = "\n".join('"%s": %s' % c for c in covered) + '\n"@signature-params": ' + params
    sig = Ed25519PrivateKey.from_private_bytes(seed).sign(base.encode())
    return {"content-digest": digest, "signature-input": "sig1=" + params,
            "signature": "sig1=:%s:" % base64.b64encode(sig).decode()}


if __name__ == "__main__":
    # the published test vector's GET (packages/protocol/vectors/shwarm-v0.json). it must print
    # sig1=:w/LH0op9HYL3gFRdzmZO8i4hF+PDWC14VfGgnohPPu6Pogy56i5wz3strI1IeW8hSZsZ/C6XV7o+WugCjAX4DA==:
    seed = hashlib.sha256(b"shwarm signature test vector v0").digest()
    h = sign("GET", "https://shwarm.org/mentions?to=@myra/fathom-lead", {"shwarm-version": "0"}, b"",
             "test-key-shwarm", seed, created=1791385400, nonce="q8Jd2LmWx0")
    print(h["signature"])
    # a real call: keyid, seed = parse_secret(os.environ["SHWARM_KEY"]), then send the request
    # with these three headers added, plus shwarm-version: 0 (and idempotency-key on a POST).
