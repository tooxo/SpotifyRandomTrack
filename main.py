import asyncio
import base64
import dataclasses
import datetime
import json
import os
import random
import re
import urllib.parse
from asyncio import Future
from typing import List, Union, Optional

import aiohttp
import api_commons.spotify
import fastapi
import uvicorn
from asyncio_pool import AioPool
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from fastapi.routing import Mount
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import RedirectResponse

routes = [
    Mount(
        path="/static",
        app=StaticFiles(directory="static", html=False),
    )
]

templates = Jinja2Templates(directory="templates")

app = fastapi.FastAPI(
    routes=routes,
)
spotify = api_commons.spotify.SpotifyApi(
    client_id=os.environ["SPOTIFY_API_ID"],
    client_secret=os.environ["SPOTIFY_API_SECRET"],
)

worker_pool = None

with open("genre_list.txt", "r") as f:
    all_genres = list(
        map(
            lambda x: x.strip(),
            f.readlines()
        )
    )


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


@app.get("/spotify_auth", response_class=HTMLResponse)
async def spotify_auth(code: str, redirect_uri: str):
    encoded = base64.b64encode(
        (os.environ['SPOTIFY_API_ID'] + ":" + os.environ['SPOTIFY_API_SECRET']).encode("ascii")).decode("ascii")

    async with aiohttp.ClientSession(
            headers={
                "Authorization": f"Basic {encoded}"
            }
    ) as s:
        async with s.post(
                "https://accounts.spotify.com/api/token",
                data={
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code"
                }
        ) as req:
            js = await req.json()
            print(js)
            return js["access_token"]


def filter_remix(song: dict) -> bool:
    if "remix" not in song["name"].lower():
        return True
    else:
        print("skip: remix")
        return False


def filter_live(song: dict) -> bool:
    if "live" not in song["name"].lower():
        return True
    else:
        print("skip: live")
        return False


def song_filter(song: dict) -> bool:
    if "A State Of Trance (ASOT" in song["name"]:
        print("skip: a state of trance")
        return False
    if song["artists"][0]["name"] == "Anonym" and "Kapitel" in song["name"]:
        print("skip: anonym kapitel")
        return False
    if re.match(r"((Kapitel)|(Teil) \d{1,4}(\.\d{1,4})?$|( -))", song["name"]) is not None:
        print(f"skip: generic kapitel; {song['name']}")
        return False
    if re.match(r"(Part)|(Chapter) \d{1,4}", song["name"]) is not None and "-" in song["name"]:
        print(f"skip: generic part; {song['name']}")
        return False
    if re.match(r"Capítulo \d{1,4}", song["name"]) is not None and "-" in song["name"]:
        print(f"skip: generic part (espanol); {song['name']}")
        return False
    return True


@dataclasses.dataclass
class Song:
    name: str
    artists: List[str]
    art: str
    id: str
    url: str
    preview_url: str

    @staticmethod
    def from_json(x: dict):
        return Song(
            artists=list(
                map(
                    lambda y: y["name"],
                    x["artists"]
                )
            ),
            name=x["name"],
            art=x["album"]["images"][0]["url"],
            preview_url=x["preview_url"],
            url=x["external_urls"]["spotify"],
            id=x["id"]
        )


@dataclasses.dataclass
class SearchSpecification:
    genre: str
    start_year: str
    end_year: str
    live: bool
    remix: bool


async def retrieve_random_song(
        specs: SearchSpecification
) -> Optional[Song]:
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    year = specs.start_year + (f'-{specs.end_year}' if specs.start_year != specs.end_year else '')

    async with aiohttp.ClientSession(
            headers={
                "Authorization": "Bearer " + (await spotify.get_auth_token_async())
            }
    ) as session:
        for _ in range(2):
            rn = random.randint(0, 1)

            r_chars = [random.choice(alphabet) for _ in range(random.randint(1, 4))]

            if specs.genre == "random":
                query = ""
            else:
                query = f"genre:\"{urllib.parse.unquote(specs.genre)}\" "

            query = \
                f"{query}track:\"{'%' if rn > 0 else ''}" \
                f"{'*'.join(r_chars)}" \
                f"{'%' if rn == 0 else ''}\""
            if specs.start_year != "1900" or specs.end_year != str(datetime.date.today().year):
                query += " year:" + year

            offset = random.randint(0, 1500)

            async with session.get(
                    url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                        f"{urllib.parse.quote(query)}&limit=1&offset={offset}"
            ) as req1:
                if not req1.ok:
                    continue

                req1_parse = await req1.json()

                if len(req1_parse["tracks"]["items"]) > 0:
                    print(f"use: no offset {offset}")

                    track = req1_parse["tracks"]["items"][0]

                    if song_filter(track) and (specs.remix or filter_remix(track)) and (
                            specs.live or filter_live(track)):
                        return Song.from_json(track)

                elif req1_parse["tracks"]["total"] > 0:
                    print(f"use: offset {offset}")
                    async with session.get(
                            url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                                f"{urllib.parse.quote(query)}&limit=1"
                                f"&offset={random.randint(0, req1_parse['tracks']['total'] - 1)}"
                    ) as req2:
                        if not req2.ok:
                            continue
                        req2_parse = await req2.json()

                        if len(req2_parse["tracks"]["items"]) > 0:
                            track = req2_parse["tracks"]["items"][0]
                            if song_filter(track) \
                                    and (specs.remix or filter_remix(track)) \
                                    and (specs.live or filter_live(track)):
                                return Song.from_json(track)


@app.get("/genres")
async def genres(artist_ids: str):
    artists = urllib.parse.unquote(artist_ids).split(",")

    async with aiohttp.ClientSession(
            headers={
                "Authorization": "Bearer " + (await spotify.get_auth_token_async())
            }
    ) as session:
        for _ in range(2):
            async with session.get(
                    f"https://api.spotify.com/v1/artists?ids={artist_ids}"
            ) as req:
                if not req.ok:
                    continue

                j = await req.json()

                return list(
                    set(
                        [
                            item for sublist in
                            map(
                                lambda x: x["genres"],
                                j["artists"]
                            )
                            for item in sublist
                        ]
                    )
                )


@app.get("/request_songs")
async def request_pool(genre: str = "pop", no: int = 5, start_year: str = "1900",
                       end_year: str = str(datetime.date.today().year), live: bool = True, remix: bool = True):
    spec = SearchSpecification(genre=genre, start_year=start_year, end_year=end_year, live=live, remix=remix)
    spec_list = [spec for _ in range(no)]

    global worker_pool
    if worker_pool is None:
        worker_pool = AioPool(size=10)

    results = await worker_pool.map(
        retrieve_random_song, spec_list
    )

    return list(
        filter(
            lambda x: x is not None,
            results
        )
    )


@app.get("/request_songs_legacy")
async def request_song(genre: str = "pop", no: int = 5, start_year: str = "1900",
                       end_year: str = str(datetime.date.today().year), live: bool = True, remix: bool = True):
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

            r_chars = [random.choice(alphabet) for _ in range(random.randint(1, 4))]
            query = \
                f"genre:\"{urllib.parse.unquote(genre)}\" track:\"{'%' if rn > 0 else ''}" \
                f"{'*'.join(r_chars)}" \
                f"{'%' if rn == 0 else ''}\""

            if start_year != "1900" or end_year != str(datetime.date.today().year):
                query += " year:" + year

            offset = random.randint(0, 1500)

            async with session.get(
                    url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                        f"{urllib.parse.quote(query)}&limit=1&offset={offset}"
            ) as s:
                ctr -= 1

                if not s.ok:
                    continue
                js = await s.json()

                if len(js["tracks"]["items"]) > 0:
                    print(f"use: no offset {offset}")
                    ctr = 2

                    if song_filter(js["tracks"]["items"][0]) \
                            and (remix or filter_remix(js["tracks"]["items"][0])) \
                            and (live or filter_live(js["tracks"]["items"][0])):
                        songs.append(js["tracks"]["items"][0])

                elif js["tracks"]["total"] > 0:
                    print(f"use: offset {offset}")
                    async with session.get(
                            url=f"https://api.spotify.com/v1/search?type=track&include_external=audio&q="
                                f"{urllib.parse.quote(query)}&limit=1&offset={random.randint(0, js['tracks']['total'] - 1)}"
                    ) as s2:
                        if not s2.ok:
                            continue
                        js2 = await s2.json()
                        if len(js2["tracks"]["items"]) > 0:
                            if song_filter(js2["tracks"]["items"][0]) \
                                    and (remix or filter_remix(js2["tracks"]["items"][0])) \
                                    and (live or filter_live(js2["tracks"]["items"][0])):
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
                "id": x["id"]
            },
            songs
        )
    )


def int_or_default(string: str, default: int):
    try:
        return int(string)
    except ValueError:
        return default
    except TypeError:
        return default


genres_string = list(
    map(
        lambda x: f'"{x.strip()}"',
        all_genres
    )
)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    if request.cookies.get("genre") is not None:
        url = "/?genre=" + request.cookies.get("genre") + "&start_year=" + request.cookies.get(
            "start_year") + "&end_year=" + request.cookies.get("end_year") + \
              (
                  (
                          "&code=" + request.query_params.get("code")
                  ) if "code" in request.query_params else ""
              ) + \
              "&live=" + request.cookies.get("live") + "&remix=" + request.cookies.get("remix")

        response = RedirectResponse(
            url=url,
        )

        response.delete_cookie("genre")
        response.delete_cookie("start_year")
        response.delete_cookie("end_year")
        response.delete_cookie("live")
        response.delete_cookie("remix")

        return response

    genre = request.query_params.get("genre") or "random"

    if urllib.parse.unquote(genre.lower()) not in all_genres:
        genre = "random"

    start_year = int_or_default(request.query_params.get("start_year"), 1900)
    end_year = int_or_default(request.query_params.get("end_year"), datetime.date.today().year)

    if start_year < 1900:
        start_year = 1900
    if end_year > datetime.date.today().year:
        end_year = datetime.date.today().year

    if start_year > end_year:
        start_year = 1900
        end_year = datetime.date.today().year

    remix = (request.query_params.get("remix") or "true") == "true"
    live = (request.query_params.get("live") or "true") == "true"

    return templates.TemplateResponse(
        "index.html", {
            "request": request,
            "GENRE_LIST": ", ".join(genres_string),
            "selected_genre": genre,
            "start_year": start_year,
            "end_year": end_year,
            "remix": "checked" if remix else "",
            "live": "checked" if live else ""
        }
    )


async def run_async():
    config = uvicorn.Config("main:app", port=os.environ.get("PORT") or 8888, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == '__main__':
    asyncio.run(run_async())
