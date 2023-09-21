import asyncio
import base64
import dataclasses
import datetime
import json
import os
import random
import re
import urllib.parse
from typing import List, Optional, Union

import aiohttp
import api_commons.spotify
import fastapi
import uvicorn
from api_commons.spotify import Album, Track
from asyncio_pool import AioPool
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from fastapi.responses import RedirectResponse
from fastapi.routing import Mount
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

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


@app.get("/spotify_auth")
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
            s.headers["Authorization"] = "Bearer " + js["access_token"]
            profile = await (await s.get("https://api.spotify.com/v1/me")).json()

            return {
                "access_token": js["access_token"],
                "refresh_token": js["refresh_token"],
                "expires_in": js["expires_in"],
                "user_id": profile["id"]
            }


@app.get("/spotify_refresh")
async def spotify_refresh(token: str):
    encoded = base64.b64encode(
        (os.environ['SPOTIFY_API_ID'] + ":" + os.environ['SPOTIFY_API_SECRET']).encode("ascii")).decode("ascii")

    async with aiohttp.ClientSession(
            headers={
                "Authorization": f"Basic {encoded}"
            }
    ) as sess:
        async with sess.post(
                "https://accounts.spotify.com/api/token",
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': token
                }
        ) as req:
            return await req.json()


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
    artist_ids: List[str]
    art: str
    id: str
    url: str
    preview_url: str

    @staticmethod
    def from_json(x: dict):
        assert x["preview_url"] is not None
        return Song(
            artists=list(
                map(
                    lambda y: y["name"],
                    x["artists"]
                )
            ),
            artist_ids=list(
                map(
                    lambda y: y["id"],
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
    type_: str
    hipster: bool


async def get_specific_song(song_id: str) -> Song:
    async with aiohttp.ClientSession(
        headers={
            "Authorization": "Bearer " + (await spotify.get_auth_token_async())
        }
    ) as session:
        for _ in range(2):
            url = f"https://api.spotify.com/v1/tracks/{song_id}"
            async with session.get(url, allow_redirects=True) as req1:
                if not req1.ok:
                    continue
                parsed = await req1.json()
                if not parsed["preview_url"]:
                    continue

                return Song.from_json(parsed)


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

            if specs.genre == "all" or specs.type_ == "album":
                query = ""
            elif specs.genre == "random":
                query = f"genre:\"{random.choice(all_genres)}\""
            else:
                query = f"genre:\"{urllib.parse.quote(specs.genre)}\""

            query = \
                f"{query}{specs.type_}:\"{'%' if rn > 0 else ''}" \
                f"{'*'.join(r_chars)}" \
                f"{'%' if rn == 0 else ''}\""
            if specs.start_year != "1900" or specs.end_year != str(datetime.date.today().year):
                query += " year:" + year
            if specs.type_ == "album":
                if specs.hipster:
                    query += " tag:hipster"

            offset = random.randint(0, 1500)

            async with session.get(
                    url=f"https://api.spotify.com/v1/search?type={specs.type_}&include_external=audio&q="
                        f"{query}&limit=1&offset={offset}"
            ) as req1:
                if not req1.ok:
                    continue

                req1_parse = await req1.json()

                if "tracks" in req1_parse and len(req1_parse["tracks"]["items"]) > 0:
                    print(f"use: no offset {offset}")

                    track = req1_parse["tracks"]["items"][0]

                    if song_filter(track) and (specs.remix or filter_remix(track)) and (
                            specs.live or filter_live(track)):
                        if not track["preview_url"]:
                            return await get_specific_song(track["id"])
                        return Song.from_json(track)

                elif "tracks" in req1_parse and req1_parse["tracks"]["total"] > 0:
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
                                if not track["preview_url"]:
                                    return await get_specific_song(track["id"])
                                return Song.from_json(track)
                elif "albums" in req1_parse and req1_parse["albums"]["total"] > 0:
                    album = Album.from_api_response(json.dumps(random.choice(req1_parse["albums"]["items"])))
                    album: Album = await album.complete_async(token=await spotify.get_auth_token_async())

                    rnd: Track = random.choice(album.tracks)
                    dic = json.loads(
                        json.dumps(
                            rnd,
                            default=lambda o: getattr(o, '__dict__', str(o))
                        )
                    )
                    dic["album"] = {
                        "images": [
                            {"url": album.images[0].url}
                        ]
                    }
                    print(dic)
                    if not track["preview_url"]:
                        return await get_specific_song(track["id"])
                    return Song.from_json(dic)


@app.get("/genres")
async def genres(artists: str):
    _artists = urllib.parse.unquote(artists).split(",")

    async with aiohttp.ClientSession(
            headers={
                "Authorization": "Bearer " + (await spotify.get_auth_token_async())
            }
    ) as session:
        for _ in range(2):
            async with session.get(
                    f"https://api.spotify.com/v1/artists?ids={','.join(_artists)}"
            ) as req:
                if not req.ok:
                    continue

                web_response = await req.json()
                break

    if len(_artists) < 2:
        return web_response["artists"][0]["genres"][:2]

    main_artist = _artists[0]
    main_response = next(
        filter(
            lambda x: x["id"] == main_artist,
            web_response["artists"]
        )
    )
    others_genres_flat = [
        item for sublist in map(
            lambda x: x["genres"],
            filter(
                lambda x: x["id"] != main_artist,
                web_response["artists"]
            )
        )
        for item in sublist
    ]
    result = []
    for n in main_response["genres"]:
        if n in others_genres_flat:
            result.append(n)

    result += main_response["genres"]

    return list(set(result))[:5]


@app.get("/request_songs")
async def request_pool(genre: str = "pop", no: int = 5, start_year: str = "1900",
                       end_year: str = str(datetime.date.today().year), live: bool = True, remix: bool = True):
    spec = SearchSpecification(genre=urllib.parse.unquote(genre), start_year=start_year, end_year=end_year, live=live, remix=remix,
                               type_="track", hipster=False)
    print(spec)
    spec_list = [spec for _ in range(no)]

    global worker_pool
    if worker_pool is None:
        worker_pool = AioPool(size=10)

    results = await worker_pool.map(
        retrieve_random_song, spec_list
    )

    return list(
        filter(
            lambda x: x is not None and x != {},
            results
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
    if request.cookies.get("search_state") is not None:
        search_state = json.loads(request.cookies.get("search_state"))
        url = "/?genre=" + search_state.get("genre") + "&start_year=" + search_state.get(
            "start_year") + "&end_year=" + search_state.get("end_year") + (
                  (
                          "&code=" + request.query_params.get("code")
                  ) if "code" in request.query_params else ""
              ) + "&live=" + str(search_state.get("live")).lower() + "&remix=" + str(search_state.get("remix")).lower()

        response = RedirectResponse(
            url=url,
        )

        response.delete_cookie("search_state")

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
    config = uvicorn.Config("main:app", host="0.0.0.0", port=(int_or_default(os.environ.get("PORT"), 8888)), log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == '__main__':
    asyncio.run(run_async())
