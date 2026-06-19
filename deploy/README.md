# Deploying duke-wasm to box.dnsif.ca & pro.dnsif.ca

> **Live instances** (deployed): **https://duke.pro.dnsif.ca** and **https://duke.box.dnsif.ca**.
> Each runs `awkto/duke-wasm:latest` as a `docker run` container on `127.0.0.1:5028`, with full
> game data at `~/duke-data/{duke1,duke2}`, fronted by the host's nginx using its
> `*.<host>.dnsif.ca` wildcard cert, and auto-updated by the host's existing Watchtower (pro
> watches all containers; box's `keen-watchtower` lists `duke-wasm`). Commands used:
>
> ```bash
> rsync -a deploy/data/  <host>:duke-data/
> docker run -d --name duke-wasm --restart unless-stopped \
>   -p 127.0.0.1:5028:80 -v /home/altanc/duke-data:/data:ro awkto/duke-wasm:latest
> # nginx vhost duke.<host>.dnsif.ca -> 127.0.0.1:5028 (cert /etc/nginx/ssl/<host>.dnsif.ca.*)
> ```

Each host runs its own container + nginx reverse proxy. The full retail Duke games live in a
mounted `/data`, so every episode runs with no uploads and the upload UI is hidden.

## 1. Stage the game files on each host

Put the **full** versions under `/srv/duke-data` (or `~/duke-data`), one subdir per game:

```
duke-data/
├── duke1/   DN1.EXE DN2.EXE DN3.EXE  *.DN1 *.DN2 *.DN3 ...   (full Duke Nukem 1, 3 episodes)
└── duke2/   NUKEM2.EXE NUKEM2.CMP NUKEM2.F1..F5 ...          (registered Duke Nukem II)
```

From your workstation (files are staged in this repo's gitignored `deploy/data/`):

```bash
rsync -av deploy/data/  box.dnsif.ca:duke-data/
rsync -av deploy/data/  pro.dnsif.ca:duke-data/
```

## 2. Run the container

```bash
docker compose up -d           # or the docker run one-liner above
docker logs duke-wasm          # should list built duke1/duke1ep2/duke1ep3/duke2 + the manifest
```

## 3. nginx reverse proxy + TLS

Install `deploy/nginx-duke.conf`, setting `server_name` (`duke.pro.dnsif.ca` / `duke.box.dnsif.ca`)
and the per-host wildcard cert paths, then `nginx -t && systemctl reload nginx`.

## 4. DNS

`duke.pro.dnsif.ca` / `duke.box.dnsif.ca` are single-label subdomains under each host's
`*.<host>.dnsif.ca` wildcard, so they resolve and are TLS-covered with no new records.

## Verify

```bash
curl -sk https://duke.box.dnsif.ca/games/manifest.json
# {"serverMode":true,"games":[{"key":"duke1",...},{"key":"duke1ep2",...},{"key":"duke1ep3",...},{"key":"duke2",...}]}
```

The site should show one-click **Play** buttons for every detected episode and **no** upload card.

## Updating (automatic via Watchtower)

Both hosts already run a Watchtower that polls Docker Hub every 5 min; tag a new `v*.*.*` release
and the running `duke-wasm` updates itself within ~5 minutes (bundles rebuild from `/data` on
every container start). Manual: `docker compose pull && docker compose up -d`.
