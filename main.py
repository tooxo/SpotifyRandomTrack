import asyncio
import datetime
import json
import os
import random
import urllib.parse

import aiofiles
import aiohttp
import api_commons.spotify
import fastapi
import hypercorn.asyncio
from fastapi.responses import HTMLResponse
from fastapi.routing import Mount
from fastapi.staticfiles import StaticFiles

routes = [
    Mount(
        path="/static",
        app=StaticFiles(directory="static", html=False),
    )
]

app = fastapi.FastAPI(
    routes=routes
)
spotify = api_commons.spotify.SpotifyApi(
    client_id=os.environ["SPOTIFY_API_ID"],
    client_secret=os.environ["SPOTIFY_API_SECRET"],
)

with open("genre_list.txt", "r") as f:
    all_genres = f.readlines()


@app.get("/rec")
async def test(pop_cap: int = 100):
    async with aiohttp.ClientSession(headers={
        "Authorization": "Bearer " + (await spotify.get_auth_token_async())
    }) as session:
        mx = random.randint(0, pop_cap)
        async with session.get(
                f"https://api.spotify.com/v1/recommendations?seed_genres=pop&max_popularity={mx}&limit=5"
        ) as req:
            return list(
                map(
                    lambda y: {"name": y.name, "artist": y.artists[0].name, "url": y.preview_url},
                    map(
                        lambda x: api_commons.spotify.Track.from_api_response(api_response=json.dumps(x)),
                        (await req.json())["tracks"]
                    )
                )
            )


@app.get("/request_songs")
async def request_song(genre: str = "pop", no: int = 5, start_year: str = "1900",
                       end_year: str = str(datetime.date.today().year)):
    async with aiohttp.ClientSession(headers={
        "Authorization": "Bearer " + (await spotify.get_auth_token_async())
    }) as session:
        alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

        songs = []
        ctr = 2

        while len(songs) < no:
            if ctr == 0:
                break
            rn = random.randint(0, 1)

            year = start_year + (f'-{end_year}' if start_year != end_year else '')

            r_chars = [random.choice(alphabet) for _ in range(random.randint(1, 3))]
            query = \
                f"genre:\"{urllib.parse.unquote(genre)}\" track:\"{'%' if rn > 0 else ''}" \
                f"{'*'.join(r_chars)}" \
                f"{'%' if rn == 0 else ''}\""

            if start_year != "1900" and end_year != str(datetime.date.today().year):
                query += " year:" + year

            offset = random.randint(0, 999)
            print(f"{query=}, {offset=}")

            async with session.get(
                    url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                        f"{urllib.parse.quote(query)}&limit=1&offset={offset}"
            ) as s:
                ctr -= 1

                if not s.ok:
                    continue
                js = await s.json()

                if len(js["tracks"]["items"]) > 0:
                    # track_a = api_commons.spotify.Track.from_api_response(json.dumps(js["tracks"]["items"][0]))

                    songs.append(js["tracks"]["items"][0])
                    ctr = 2
                elif js["tracks"]["total"] > 0:
                    async with session.get(
                            url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                                f"{urllib.parse.quote(query)}&limit=1&offset={random.randint(0, js['tracks']['total'] - 1)}"
                    ) as s2:
                        print("offset correction request")
                        if not s2.ok:
                            continue
                        js2 = await s2.json()
                        if len(js2["tracks"]["items"]) > 0:
                            songs.append(js2["tracks"]["items"][0])
                            ctr = 2

    return list(
        map(
            lambda x: {
                "artists":
                    list(
                        map(
                            lambda y: y["name"],
                            x["artists"]
                        )
                    ),
                "name": x["name"],
                "art": x["album"]["images"][0]["url"],
                "preview_url": x["preview_url"],
                "url": x["external_urls"]["spotify"],
            },
            songs
        )
    )


@app.get("/", response_class=HTMLResponse)
async def index():
    # const genre_list = [];

    async with aiofiles.open("static/index.html", "r") as file:
        content = await file.read()

        genres_string = list(
            map(
                lambda x: f'"{x.strip()}"',
                all_genres
            )
        )

        return content.replace("const genre_list = [];", f"const genre_list = [{','.join(genres_string)}];")


if __name__ == '__main__':
    asyncio.run(
        hypercorn.asyncio.serve(app, hypercorn.config.Config())
    )
