const spotify = document.getElementById("spotify-auth");
const spotify_playlist_progress = document.getElementById("create-playlist-progress");

const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
});

function redirect_uri() {
    return location.protocol + '//' + location.host + location.pathname;
}

function authorizeSpotify() {
    const client_id = "ed8a00aa20d54561942f418c30cf6d72";
    const scope = "playlist-modify-private playlist-modify-public playlist-read-private";
    const state = Date.now().toFixed();

    document.cookie = "genre=" + selected_genre + ";"
    document.cookie = "start_year=" + start_year.value + ";"
    document.cookie = "end_year=" + end_year.value + ";"
    document.cookie = "remix=" + remix.checked + ";";
    document.cookie = "live=" + live.checked + ";";

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


async function assureAuth() {
    if (getSpotifyInfo() != null) {
        const info = getSpotifyInfo();
        if (
            Date.parse(info["expire_date"]) < Date.now()
        ) {
            // refresh
            const resp = await fetch(
                "/spotify_refresh?token=" + info["refresh_token"]
            );
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

        window.history.replaceState(
            null,
            "",
            redirect_uri() + "?" + loc_params.toString()
        )
    } else {
        // TODO: somehow save current state
        authorizeSpotify();
    }
}


async function createPlaylist() {
    spotify.disabled = true;
    const try_num = 50;

    const context = assureAuth();

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
    document.cookie = encodeURIComponent(sKey) +
        "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" +
        (sDomain ? "; domain=" + sDomain : "") +
        (sPath ? "; path=" + sPath : "");
}

const PLAYLIST_NAME = "SpotifyRandomTracks – Favourites"

async function playlistWithThisName(name, auth_token) {
    let json = {"next": "https://api.spotify.com/v1/me/playlists?limit=50"}
    while (json["next"] !== null) {
        let response = await fetch(
            json["next"],
            {
                headers: {
                    Authorization: "Bearer " + auth_token
                }
            }
        )
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
        const context = await assureAuth();

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
        const context = await assureAuth();
        const response = await fetch(
            "https://api.spotify.com/v1/playlists/" + id,
            {
                headers: {
                    "Authorization": "Bearer " + context["access_token"]
                }
            }
        );
        if (!response.ok) {
            deleteCookie("playlist");
            return await getFavouritePlaylist();
        }
    }

    return id;
}

async function addToFav() {
    let current_song;
    if (random_songs.isBack)
        current_song = random_songs.minus_one;
    else
        current_song = random_songs.current;

    const id = current_song["id"];
    const playlist_id = await getFavouritePlaylist();
    const context = await assureAuth();

    await fetch(
        "https://api.spotify.com/v1/playlists/" + playlist_id + "/tracks",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + context["access_token"]
            },
            body: JSON.stringify(["spotify:track:" + id])
        }
    )
}


if (params.code !== null)
    assureAuth().then();

const action = getCookie("nextAction");
if (action === "playlist") {
    spotify.hidden = true;
    deleteCookie("nextAction");
    createPlaylist().then();
} else if (action === "favourite") {

}


