const artist_name = document.getElementById("artists");
const song_name = document.getElementById("song_name");

const art_image = document.getElementById("song_art");
const song_url = document.getElementById("song_url");

const input = document.getElementById("genre_search");
const drop = document.getElementById("drop-container");

const start_year = document.getElementById("year_from");
const end_year = document.getElementById("year_to");

const audio = document.getElementById("audio");

const play_pause = document.getElementById("play_pause");

const song_art_container = document.getElementById("song_art_container");
const hover_over = document.getElementById("hover_over");

function Mutex() {
    let current = Promise.resolve();
    this.lock = () => {
        let _resolve;
        const p = new Promise(resolve => {
            _resolve = () => resolve();
        });
        const rv = current.then(() => _resolve);
        current = p;
        return rv;
    };
}

let list_lock = new Mutex();
let random_songs = [];
let selected_genre = 'pop';

function get_selected_genres() {
    if (genre_list.includes(selected_genre))
        return selected_genre;
    return 'pop';
}

function get_start_year() {
    if (start_year.value.match(start_year.pattern) === null) {
        start_year.value = '1900';
    }
    return start_year.value;
}

function get_end_year() {
    if (end_year.value.match(end_year.pattern) === null) {
        end_year.value = new Date().getFullYear().toString();
    }
    return end_year.value;
}

async function fill_up_random_songs() {
    let promise = await list_lock.lock();
    if (random_songs.length > 0) {
        promise();
        return;
    }

    let response = await fetch(
        "/request_songs?genre=" + get_selected_genres() + "&no=5&start_year=" + get_start_year() + "&end_year=" + get_end_year(),
    )

    if (response.ok) {
        let json_parsed = await response.json();

        random_songs.push(...json_parsed);
    }

    promise();
}

async function get_random_song() {
    if (random_songs.length === 0) {
        await fill_up_random_songs();
    } else if (random_songs.length === 1) {
        fill_up_random_songs().then();
    }

    return random_songs.pop()
}

function display_song(song) {
    const artists = song.artists;
    const song_n = song.name;
    const art = song.art;

    artist_name.innerText = artists.join(", ");
    song_name.innerText = song_n;
    art_image.src = art;
    song_url.href = song.url;
    audio.src = song.preview_url;
}

function dice() {
    play_pause.src = "/static/play-button.png";
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=";

    get_random_song().then(
        value => display_song(value)
    );
}

function filterDropdown() {
    return genre_list.filter(
        value => value.includes(input.value.trim())
    ).filter((_, index) => index < 20);
}

function clickDropdown(genre) {
    selected_genre = genre;
    input.value = genre;
    random_songs = [];
    dice();
}

function createDropdownChild(name) {
    let p = document.createElement('p');
    p.classList.add("drop-item");
    p.innerText = name;
    p.onclick = () => clickDropdown(name);


    return p;
}

function updateDropdown() {
    while (drop.firstChild) {
        drop.removeChild(drop.lastChild);
    }

    for (let name of filterDropdown()) {
        drop.appendChild(
            createDropdownChild(name)
        );
    }
}

input.addEventListener(
    "focusin",
    ev => {
        updateDropdown();
        drop.hidden = false;
    }
);


window.onclick = function (event) {
    if (!event.target.matches('#genre_search')) {
        drop.hidden = true;
    }
}


input.addEventListener(
    "keyup",
    ev => updateDropdown()
)

play_pause.addEventListener(
    "click",
    ev => {
        if (!audio.paused) {
            audio.pause();
        } else {
            audio.play();
        }
    }
);

audio.addEventListener(
    "play",
    ev => {
        play_pause.src = "/static/pause-button.png";
    }
);

audio.addEventListener(
    "pause",
    ev => {
        play_pause.src = "/static/play-button.png";
    }
);

song_art_container.addEventListener(
    "mouseenter",
    ev => {
        hover_over.style.display = "flex";
    }
);

song_art_container.addEventListener(
    "mouseleave",
    ev => {
        hover_over.style.display = "none";
    }
);

function checkYearInput() {
    if (start_year.value.match(start_year.pattern)) {
        start_year.style.border = "2px solid black";
    } else {
        start_year.style.border = "2px solid red";
    }

    if (end_year.value.match(end_year.pattern)) {
        end_year.style.border = "2px solid black";
    } else {
        end_year.style.border = "2px solid red";
    }

    if (Number.parseInt(start_year.value) > Number.parseInt(end_year.value)) {
        start_year.style.border = "2px solid red";
        end_year.style.border = "2px solid red";
    }
}

start_year.addEventListener(
    "focusout",
    ev => {
        checkYearInput();
    }
);

end_year.addEventListener(
    "focusout",
    ev => {
        checkYearInput();
    }
);


dice();
