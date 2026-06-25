-- Track the access-token jti minted with each session so logout can denylist it.
ALTER TABLE "Session" ADD COLUMN "accessTokenId" UUID;
