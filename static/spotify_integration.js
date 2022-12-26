const spotify = document.getElementById("spotify-auth");
const spotify_playlist_progress = document.getElementById("create-playlist-progress");

const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
});

let songs_added_this_session = [];

function redirect_uri() {
    return location.protocol + '//' + location.host + location.pathname;
}

function authorizeSpotify(intention) {
    const client_id = "ed8a00aa20d54561942f418c30cf6d72";
    const scope = "playlist-modify-private playlist-modify-public playlist-read-private";
    const state = Date.now().toFixed();

    document.cookie = "search_state=" + JSON.stringify({
        "genre": selected_genre,
        "start_year": start_year.value,
        "end_year": end_year.value,
        "remix": remix.checked,
        "live": remix.checked
    });

    document.cookie = "intention=" + intention;
    document.cookie = "song_state=" + JSON.stringify({
        "current": random_songs.current, "minus_one": random_songs.minus_one,
    })

    window.location = "https://accounts.spotify.com/authorize?response_type=code" + "&client_id=" + client_id + "&scope=" + scope + "&redirect_uri=" + redirect_uri() + "&state=" + state;
}

let userId = () => {
    return getSpotifyInfo().user_id;
};

const cookie_name = "SPOTIFY_INFO"
const getSpotifyInfo = () => {
    return JSON.parse(getCookie(cookie_name) || null);
}
const setSpotifyInfo = (newVal) => {
    const expire_date = new Date(new Date().getTime() + newVal["expires_in"] * 1000);
    newVal["expire_date"] = expire_date.toUTCString();
    document.cookie = cookie_name + "=" + JSON.stringify(newVal)
}


async function assureAuth(intention) {
    if (getSpotifyInfo() != null) {
        const info = getSpotifyInfo();
        if (Date.parse(info["expire_date"]) < Date.now()) {
            // refresh
            const resp = await fetch("/spotify_refresh?token=" + info["refresh_token"]);
            const par = await resp.json();

            const newInfo = getSpotifyInfo();
            newInfo["access_token"] = par["access_token"];
            newInfo["refresh_token"] = par["refresh_token"];
            newInfo["expires_in"] = par["expires_in"];

            setSpotifyInfo(newInfo);

            return newInfo;
        } else {
            return getSpotifyInfo();
        }
    } else if (params.code !== null) {
        const loc_params = new URLSearchParams(window.location.search);
        let response = await fetch("/spotify_auth?code=" + loc_params.get("code") + "&redirect_uri=" + redirect_uri());
        setSpotifyInfo(await response.json())

        loc_params.delete("code");

        window.history.replaceState(null, "", redirect_uri() + "?" + loc_params.toString())
    } else {
        authorizeSpotify(intention);
    }
}


async function createPlaylist() {
    spotify.disabled = true;
    const try_num = 50;

    const context = assureAuth("playlist");

    let r = (Math.random() + 1).toString(36).substring(7);

    let playlistCreate = await fetch("https://api.spotify.com/v1/users/" + userId() + "/playlists", {
        method: "POST", headers: {
            Authorization: "Bearer " + context["access_token"]
        }, body: JSON.stringify({
            "name": selected_genre + " - random playlist (" + r + ")",
            "public": false,
            "collaborative": false,
            "description": ""
        })
    });
    let plcJson = await playlistCreate.json();

    spotify_playlist_progress.hidden = false;

    let added = 0;
    while (try_num > added) {
        let r = await fetch("/request_songs?genre=" + get_selected_genres() + "&no=5&start_year=" + get_start_year() + "&end_year=" + get_end_year());

        let arr = await r.json();
        arr = arr.map(value => "spotify:track:" + value.id);

        await fetch("https://api.spotify.com/v1/playlists/" + plcJson["id"] + "/tracks", {
            method: "POST", headers: {
                Authorization: "Bearer " + context["access_token"]
            }, body: JSON.stringify({
                uris: arr
            })
        });
        added += 5;

        spotify_playlist_progress.innerText = added + " / " + try_num;
    }
    spotify_playlist_progress.innerText = "Click to open playlist";
    spotify_playlist_progress.href = "https://open.spotify.com/playlist/" + plcJson["id"];

    spotify.disabled = false;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function deleteCookie(sKey, sPath, sDomain) {
    document.cookie = encodeURIComponent(sKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "");
}

const PLAYLIST_NAME = "SpotifyRandomTracks – Favourites"

async function playlistWithThisName(name, auth_token) {
    let json = {"next": "https://api.spotify.com/v1/me/playlists?limit=50"}
    while (json["next"] !== null) {
        let response = await fetch(json["next"], {
            headers: {
                Authorization: "Bearer " + auth_token
            }
        })
        json = await response.json();
        for (let x of json["items"]) {
            if (x["name"] === name) {
                return x["id"];
            }
        }

        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

async function getFavouritePlaylist() {
    let id = getCookie("playlist");
    if (id === undefined) {
        const context = await assureAuth("favourite");

        id = await playlistWithThisName(PLAYLIST_NAME, context["access_token"]);

        if (id === null) {
            const response = await fetch("https://api.spotify.com/v1/users/" + userId() + "/playlists", {
                method: "POST", headers: {
                    Authorization: "Bearer " + context["access_token"]
                }, body: JSON.stringify({
                    "name": PLAYLIST_NAME, "public": false, "collaborative": false, "description": ""
                })
            });
            const json = await response.json();
            id = json["id"];
        }

        document.cookie = "playlist=" + id;
    } else {
        // assure this playlist still exists
        const context = await assureAuth("favourite");
        const response = await fetch("https://api.spotify.com/v1/playlists/" + id, {
            headers: {
                "Authorization": "Bearer " + context["access_token"]
            }
        });
        if (!response.ok) {
            deleteCookie("playlist");
            return await getFavouritePlaylist();
        }
    }

    return id;
}

function updateFavButton(id) {
    if (songs_added_this_session.includes(id) ) {
        fav.src = "/static/playlist_added.png"
        fav.classList.add("playlist_active");
        fav.onclick = () => removeFromFav()
    } else {
        fav.src = "/static/playlist.png"
        fav.classList.removeAll("playlist_active");
        fav.onclick = () => addToFav()
    }
}

async function addToFav() {
    let current_song;
    if (random_songs.isBack) current_song = random_songs.minus_one; else current_song = random_songs.current;

    const id = current_song["id"];
    const playlist_id = await getFavouritePlaylist();
    const context = await assureAuth("favourite");

    await fetch("https://api.spotify.com/v1/playlists/" + playlist_id + "/tracks", {
        method: "POST", headers: {
            "Authorization": "Bearer " + context["access_token"]
        }, body: JSON.stringify(["spotify:track:" + id])
    });

    songs_added_this_session.push(id);
    updateFavButton(id);
}

async function removeFromFav() {
    let current_song;
    if (random_songs.isBack) current_song = random_songs.minus_one; else current_song = random_songs.current;

    const id = current_song["id"];
    const playlist_id = await getFavouritePlaylist();
    const context = await assureAuth("favourite_removal");

    await fetch("https://api.spotify.com/v1/playlists/" + playlist_id + "/tracks", {
        method: "DELETE", headers: {
            "Authorization": "Bearer " + context["access_token"]
        }, body: JSON.stringify({"tracks": [{"uri": "spotify:track:" + id}]})
    });

    songs_added_this_session = songs_added_this_session.filter(value => value !== id);
    updateFavButton(id);
}

if (params.code !== null) {
    assureAuth("code").then(() => {
        const action = getCookie("intention");
        deleteCookie("intention");
        if (action === "playlist") {
            spotify.hidden = true;
            createPlaylist().then();
        } else if (action === "favourite") {
            // load from state
            const state = JSON.parse(getCookie("song_state"));

            random_songs.current = state["current"]
            random_songs.minus_one = state["minus_one"]

            deleteCookie("song_state");
            display_song(random_songs.current);

            addToFav().then();
        }
    });
} else dice(true)

