const artist_name = document.getElementById("artists");
const song_name = document.getElementById("song_name");

const art_image = document.getElementById("song_art");
const art_image_bottom = document.getElementById("song_art_bottom");

const song_url = document.getElementById("song_url");

const input = document.getElementById("genre_search");
const drop = document.getElementById("drop-container");

const start_year = document.getElementById("year_from");
const end_year = document.getElementById("year_to");

const audio = document.getElementById("audio");

const play_pause = document.getElementById("play_pause");

const song_art_container = document.getElementById("song_art_container");
const hover_over = document.getElementById("hover_over");

const live = document.getElementById("show_live");
const remix = document.getElementById("show_remix");

const scroll = document.getElementById("scroll-bar");

const back_btn = document.getElementById("back");

const fav = document.getElementById("fav");

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
let random_songs = new PlusOneList();

function PlusOneList() {
    this.backlist = [];
    this.current = null;
    this.minus_one = null;
    this.isBack = false;

    this.pop = () => {
        this.minus_one = this.current;
        this.current = this.backlist.pop();

        console.log("minus_one: ", this.minus_one, " current: ", this.current);

        return this.current;
    }
    this.backward = () => this.isBack = true;
    this.forward = () => this.isBack = false;
    this.push = (...f) => this.backlist.push(...f);
    this.length = () => this.backlist.length;
    this.clear = () => {
        this.backlist = [];
        this.current = null;
        this.minus_one = null;
    }
}

function get_selected_genres() {
    if (genre_list.includes(selected_genre)) return selected_genre;
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
    console.log("started request");
    let promise = await list_lock.lock();

    let parse = null;
    for (let i = 0; i < 3; i++) {
        let response = await fetch("/request_songs?genre=" + get_selected_genres() + "&no=5&start_year=" + get_start_year() + "&end_year=" + get_end_year() + "&live=" + live.checked + "&remix=" + remix.checked,)

        if (response.ok && (parse = await response.json()).length !== 0) {
            console.log("found after " + (i + 1) + " attempt(s)");
            break;
        } else {
            console.log("response.ok=" + response.ok + " i=" + i + " parse.length=" + (parse || []).length);
        }

    }

    if (parse !== null) {
        random_songs.push(...parse);
    }

    promise();
}

async function get_random_song() {
    console.log(random_songs.length());
    if (random_songs.length() === 0) {
        await fill_up_random_songs();
    } else if (random_songs.length() === 2) {
        fill_up_random_songs().then();
    }

    return random_songs.pop()
}

let imagePosition = "top";

DOMTokenList.prototype.removeAll = function (v) {
    for (let i = 0; i < this.length; i++) {
        this.remove(v);
    }
}

function display_song(song) {
    const artists = song.artists;
    const song_n = song.name;
    const art = song.art;

    artist_name.innerText = artists.join(", ");
    song_name.innerText = song_n;

    if (imagePosition === "top") {
        art_image_bottom.src = art;

        art_image.classList.removeAll("opacity-hundred");
        art_image_bottom.classList.add("opacity-hundred");

        imagePosition = "bottom";
    } else {
        art_image.src = art;

        art_image_bottom.classList.removeAll("opacity-hundred");
        art_image.classList.add("opacity-hundred");

        imagePosition = "top";
    }


    song_url.href = song.url;
    audio.src = song.preview_url;

    updateFavButton(song.id);

    fetchGenres(song).then();
}

const genres = document.getElementById("genres");

async function fetchGenres(song) {
    let art = song.artist_ids.join(",")
    genres.innerText = " "

    const response = await fetch("/genres?artists=" + art);
    if (!response.ok) genres.innerText = "error while fetching genres"; else genres.innerText = (await response.json()).join(", ");
}

function checkButtonFunc() {
    if (random_songs.minus_one !== null && !random_songs.isBack) {
        back_btn.classList.removeAll("hide");
    } else {
        back_btn.classList.add("hide");
    }
}

let de_bounce = new Date();
const DE_BOUNCE_MILLIS = 500;

function dice(initial) {
    if (!initial && de_bounce.getTime() + DE_BOUNCE_MILLIS > new Date().getTime()) {
        return;
    }

    de_bounce = new Date();
    const continue_playing = audio.duration > 0 && !audio.paused;

    play_pause.src = "/static/play-button.png";
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=";

    if (random_songs.minus_one !== null && random_songs.isBack) {
        display_song(random_songs.current);
        random_songs.forward();
    } else {
        get_random_song().then(value => {
            display_song(value);

            if (continue_playing) {
                audio.play();
            }
        });
    }
    checkButtonFunc();
}

function back() {
    if (random_songs.minus_one !== null && !random_songs.isBack) {
        display_song(random_songs.minus_one);
        random_songs.backward();
        checkButtonFunc();
    }
}

Array.prototype.includesAll = function (...args) {
    return args.every(item => this.includes(item));
}

function advancedIncludes(pattern, object) {
    if (object.includes(pattern)) return true;
    if (object.split(" ").includesAll(...pattern.split(" "))) return true;
    if (object.replace(" ", "").includes(pattern.replace(" ", ""))) return true;

    return false;
}

function filterDropdown() {
    return genre_list.filter(value => advancedIncludes(input.value.trim().toLowerCase(), value.trim().toLowerCase())).filter((_, index) => index < 20);
}

function clickDropdown(genre) {
    selected_genre = genre;
    input.value = genre;
    random_songs.clear();
    dice(false);
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
        drop.appendChild(createDropdownChild(name));
    }
}

input.addEventListener("focusin", () => {
    updateDropdown();
    drop.hidden = false;
});


window.onclick = function (event) {
    if (!event.target.matches('#genre_search')) {
        drop.hidden = true;
    }
}


input.addEventListener("keyup", () => updateDropdown())

play_pause.addEventListener("click", () => {
    if (!audio.paused) {
        audio.pause();
    } else {
        audio.play();
    }
});

audio.addEventListener("play", () => {
    play_pause.src = "/static/pause-button.png";
});

audio.addEventListener("pause", () => {
    play_pause.src = "/static/play-button.png";
});

song_art_container.addEventListener("mouseenter", () => {
    hover_over.style.opacity = "1";
    hover_over.style.zIndex = "2";
});

song_art_container.addEventListener("mouseleave", () => {
    hover_over.style.opacity = "0";
    hover_over.style.zIndex = "-2";
});

function checkYearInput() {
    if (start_year.value.match(start_year.pattern)) {
        start_year.style.border = "2px solid #202020";
    } else {
        start_year.style.border = "2px solid red";
    }

    if (end_year.value.match(end_year.pattern)) {
        end_year.style.border = "2px solid #202020";
    } else {
        end_year.style.border = "2px solid red";
    }

    if (Number.parseInt(start_year.value) > Number.parseInt(end_year.value)) {
        start_year.style.border = "2px solid red";
        end_year.style.border = "2px solid red";
    }
}

start_year.addEventListener("focusout", () => {
    checkYearInput();
});

end_year.addEventListener("focusout", () => {
    checkYearInput();
});


const progress = document.getElementById("progress");
const knob = document.getElementById("knob");

let lock = false;
audio.addEventListener("timeupdate", () => {
        progress.style.width = (audio.currentTime / audio.duration * 100) + "%";
        if (!lock)
            knob.style.left = (audio.currentTime / audio.duration) * scroll.offsetWidth + "px";
    }
)

const mouseMove = function (ev) {
    const dx = Number.parseInt(knob.style.left.replace("px", "")) + (ev.clientX - start_pos.x);
    knob.style.left = Math.min(Math.max(dx, 0), scroll.offsetWidth) + "px";

    start_pos.x = ev.clientX;

    const perc = dx / scroll.offsetWidth;
    audio.currentTime = audio.duration * perc
}
const mouseUp = function (ev) {
    document.removeEventListener('mousemove', mouseMove);
    document.removeEventListener('mouseup', mouseUp);
    lock = false;
}

let start_pos = {x: 0, y: 0}
knob.addEventListener("mousedown", ev => {
    lock = true;
    start_pos.x = ev.clientX;
    start_pos.y = ev.clientY;

    document.addEventListener("mousemove", mouseMove);
    document.addEventListener("mouseup", mouseUp)
});

scroll.addEventListener(
    "click", ev => {
        const perc = ev.offsetX / scroll.offsetWidth;
        audio.currentTime = audio.duration * perc
    }
)


art_image.addEventListener("transitionend", ev => {
    if (ev.target.opacity === 0) art_image_bottom.src = ""
})

art_image_bottom.addEventListener("transitionend", ev => {
    if (ev.target.opacity === 0) art_image.src = ""
})
