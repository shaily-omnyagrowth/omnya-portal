// Generated from the Omnya Growth landing page HTML. Edit freely; it is plain HTML/CSS.
const LANDING_CSS = `
:root {
            color-scheme: light
        }

        html,
        body {
            margin: 0;
            padding: 0
        }

        img {
            max-width: 100%
        }

        [hidden]:not([hidden=until-found]) {
            display: none !important
        }

        /* volume spread: real grid beside the note */
        .spread {
            display: grid;
            grid-template-columns: minmax(0, 420px) 1fr;
            gap: 38px;
            align-items: start;
            margin-top: 28px;
            padding-top: 26px;
            border-top: 1px solid var(--hairline)
        }

        .spreadfig {
            margin: 0
        }

        .spreadfig img {
            display: block;
            width: 100%;
            height: auto;
            border-radius: var(--r-sm);
            box-shadow: 0 22px 44px -26px rgba(11, 11, 12, .5), inset 0 0 0 1px rgba(11, 11, 12, .1)
        }

        .spreadfig figcaption {
            margin-top: 12px;
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint)
        }

        .spreadnote {
            display: flex;
            flex-direction: column;
            gap: 16px
        }

        #method .spread .note {
            margin: 0;
            max-width: 46ch;
            padding-top: 0;
            border-top: 0
        }

        @media (max-width:820px) {
            .spread {
                grid-template-columns: 1fr;
                gap: 26px
            }

            .spreadfig img {
                max-width: 360px
            }

            #method .spread .note {
                max-width: none
            }
        }

        .spread {
            grid-template-columns: minmax(0, 340px) 1fr
        }

        .gap {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            margin-top: 6px;
            border-top: 1px solid var(--hairline);
            max-width: 46ch
        }

        .gap>div {
            padding: 16px 20px 0 0
        }

        .gap>div+div {
            border-left: 1px solid var(--hairline);
            padding-left: 20px;
            padding-right: 0
        }

        .gap b {
            display: block;
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.03em;
            line-height: 1;
            font-size: clamp(22px, 2.4vw, 30px);
            font-variant-numeric: tabular-nums
        }

        .gap span {
            display: block;
            margin-top: 9px;
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: var(--ink-faint);
            line-height: 1.45
        }

        @media (max-width:820px) {
            .gap {
                max-width: none
            }
        }

        /* linked reel tiles */
        .tile {
            margin: 0
        }

        a.tile {
            text-decoration: none;
            color: inherit;
            cursor: pointer
        }

        a.tile:hover {
            border-color: rgba(255, 255, 255, .42)
        }

        a.tile:focus-visible {
            outline: 2.5px solid #F5F5F3;
            outline-offset: 4px
        }

        .tile .tl {
            display: flex;
            flex-direction: column;
            gap: 5px
        }

        .tile .tl i {
            font-style: normal;
            font-family: var(--display);
            font-weight: 800;
            font-size: 12.5px;
            letter-spacing: -.01em;
            text-transform: none;
            color: #F5F5F3
        }

        a.tile .tb b {
            transition: transform .35s var(--ease)
        }

        a.tile:hover .tb b {
            transform: translateX(3px)
        }

        a.tile::after {
            content: "";
            position: absolute;
            top: 14px;
            right: 14px;
            width: 15px;
            height: 15px;
            z-index: 2;
            background: no-repeat center/contain url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23F5F5F3' stroke-width='1.7' stroke-linecap='round'><path d='M4.5 11.5L11.5 4.5M6 4.5h5.5V10'/></svg>");
            opacity: .5;
            transition: opacity .25s ease, transform .35s var(--ease)
        }

        a.tile:hover::after {
            opacity: 1;
            transform: translate(2px, -2px)
        }

        /* real covers behind the reel tiles */
        .tile img.cover {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            z-index: 0;
            transition: transform .6s var(--ease), opacity .3s ease;
            opacity: 1
        }

        a.tile:hover img.cover {
            transform: scale(1.05);
            opacity: 1
        }

        .tile::before {
            content: "";
            position: absolute;
            inset: 0;
            z-index: 1;
            pointer-events: none;
            background: linear-gradient(to bottom, rgba(11, 11, 12, .62) 0%, rgba(11, 11, 12, .06) 24%,
                    rgba(11, 11, 12, .06) 54%, rgba(11, 11, 12, .84) 100%)
        }

        .tile:not(:has(img.cover))::before {
            display: none
        }

:root {
            --ground: #EEEEEC;
            --ground-2: #E6E6E3;
            --ink: #0B0B0C;
            --ink-soft: #55565A;
            --ink-faint: #8A8B8F;
            --hairline: rgba(11, 11, 12, .15);
            --hairline-soft: rgba(11, 11, 12, .07);
            --chrome-hi: #F2F3F5;
            --chrome-mid: #B6BAC0;
            --chrome-lo: #787E86;
            --display: "Nunito", "Trebuchet MS", Avenir, sans-serif;
            --body: "Outfit", "Helvetica Neue", Arial, sans-serif;
            --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
            --wrap: 1200px;
            --pad: 32px;
            --r-sm: 12px;
            --r: 20px;
            --r-lg: 30px;
            --r-xl: 44px;
            --pill: 999px;
            --slab-gap: 20px;
            --soft: 0 30px 70px -38px rgba(11, 11, 12, .55);
            --ease: cubic-bezier(.34, 1.56, .64, 1);
        }

        * {
            box-sizing: border-box
        }

        html {
            -webkit-text-size-adjust: 100%;
            scroll-behavior: smooth
        }

        body {
            margin: 0;
            background: var(--ground);
            color: var(--ink);
            font-family: var(--display);
            font-size: 16px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }

        @media (prefers-reduced-motion:reduce) {
            html {
                scroll-behavior: auto
            }

            * {
                animation: none !important;
                transition: none !important
            }
        }

        .wrap {
            max-width: var(--wrap);
            margin-inline: auto;
            padding-inline: var(--pad);
            width: 100%
        }

        .rule {
            border-top: 1px solid var(--hairline)
        }

        .mono {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint)
        }

        .serif {
            font-family: var(--body);
            font-weight: 300
        }

        /* vertical grid lines */
        .gridlines {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            display: flex;
            justify-content: center
        }

        .gridlines i {
            display: block;
            width: 100%;
            max-width: var(--wrap);
            height: 100%;
            margin-inline: auto;
            background-image: repeating-linear-gradient(to right, var(--hairline-soft) 0 1px, transparent 1px calc(100%/6));
            background-position: var(--pad) 0;
            background-size: calc(100% - var(--pad)*2) 100%;
            background-repeat: no-repeat
        }

        @media (max-width:900px) {
            .gridlines {
                display: none
            }
        }

        /* nav */
        header.nav {
            position: sticky;
            top: 0;
            z-index: 40;
            background: color-mix(in srgb, var(--ground) 86%, transparent);
            backdrop-filter: saturate(1.2) blur(10px);
            border-bottom: 1px solid var(--hairline)
        }

        .nav .wrap {
            display: flex;
            align-items: center;
            gap: 28px;
            height: 62px
        }

        .mark {
            font-family: var(--display);
            font-weight: 900;
            font-size: 17px;
            letter-spacing: -.02em;
            text-decoration: none;
            color: var(--ink);
            display: flex;
            align-items: center;
            gap: 9px
        }

        .mark span.ring {
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: conic-gradient(from 210deg, var(--chrome-lo), var(--chrome-hi), var(--chrome-mid), var(--chrome-lo), var(--chrome-hi), var(--chrome-lo));
            box-shadow: inset 0 0 0 3.5px var(--ground)
        }

        .nav nav {
            margin-left: auto;
            display: flex;
            gap: 26px;
            align-items: center
        }

        .nav nav a {
            font-size: 13px;
            color: var(--ink-soft);
            text-decoration: none;
            letter-spacing: .01em
        }

        .nav nav a:hover {
            color: var(--ink)
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: 9px;
            font-family: var(--display);
            font-weight: 800;
            font-size: 13.5px;
            letter-spacing: -.005em;
            padding: 11px 18px;
            border: 1px solid var(--ink);
            color: var(--ground);
            background: var(--ink);
            text-decoration: none;
            transition: background .18s ease, color .18s ease
        }

        .btn:hover {
            background: transparent;
            color: var(--ink)
        }

        .btn.ghost {
            background: transparent;
            color: var(--ink);
            border-color: var(--hairline)
        }

        .btn.ghost:hover {
            border-color: var(--ink);
            background: transparent
        }

        a:focus-visible,
        button:focus-visible {
            outline: 2px solid var(--ink);
            outline-offset: 3px
        }

        @media (max-width:820px) {
            .nav nav a.hide-sm {
                display: none
            }
        }

        /* hero */
        .hero {
            position: relative;
            z-index: 1;
            padding-top: 74px;
            padding-bottom: 0
        }

        .hero .inner {
            display: grid;
            grid-template-columns: 1.12fr .88fr;
            gap: 48px;
            align-items: center
        }

        h1 {
            font-family: var(--display);
            font-weight: 900;
            letter-spacing: -.028em;
            line-height: .97;
            font-size: clamp(40px, 6.4vw, 80px);
            margin: 20px 0 0;
            text-wrap: balance
        }

        h1 em {
            font-style: normal;
            background: linear-gradient(94deg, #43484f, #0d0f12 20%, #767c85 44%, #15181c 66%, #575d65 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent
        }

        .hero p.lede {
            font-family: var(--body);
            font-weight: 300;
            font-size: clamp(17px, 1.55vw, 20.5px);
            line-height: 1.55;
            color: var(--ink-soft);
            max-width: 50ch;
            margin: 24px 0 0
        }

        .hero .cta {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 32px;
            padding-bottom: 76px
        }

        .ringwrap {
            position: relative;
            aspect-ratio: 1;
            width: 100%;
            max-width: 430px;
            justify-self: end
        }

        #ring {
            width: 100%;
            height: 100%;
            display: block
        }

        @media (max-width:900px) {
            .hero .inner {
                grid-template-columns: 1fr;
                gap: 8px
            }

            .ringwrap {
                order: -1;
                max-width: 230px;
                justify-self: start;
                margin-top: 8px
            }

            .hero .cta {
                padding-bottom: 56px
            }
        }

        /* fact strip */
        .facts {
            position: relative;
            z-index: 1;
            background: var(--ground-2);
            border-top: 1px solid var(--hairline);
            border-bottom: 1px solid var(--hairline)
        }

        .facts .wrap {
            display: grid;
            grid-template-columns: repeat(4, 1fr)
        }

        .fact {
            padding: 26px 26px 26px 0;
            border-left: 1px solid var(--hairline);
            padding-left: 22px
        }

        .fact:first-child {
            border-left: 0;
            padding-left: 0
        }

        .fact b {
            display: block;
            font-family: var(--display);
            font-weight: 800;
            font-size: clamp(22px, 2.4vw, 30px);
            letter-spacing: -.03em;
            line-height: 1.06;
            font-variant-numeric: tabular-nums
        }

        .fact span {
            display: block;
            margin-top: 8px;
            font-size: 12.5px;
            line-height: 1.42;
            color: var(--ink-soft)
        }

        @media (max-width:820px) {
            .facts .wrap {
                grid-template-columns: 1fr 1fr
            }

            .fact {
                padding: 20px 16px;
                border-left: 1px solid var(--hairline);
                border-top: 1px solid var(--hairline)
            }

            .fact:nth-child(-n+2) {
                border-top: 0
            }

            .fact:nth-child(odd) {
                border-left: 0;
                padding-left: 0
            }
        }

        /* generic section */
        section.sec {
            position: relative;
            z-index: 1;
            padding: 84px 0
        }

        section[id],
        main[id] {
            scroll-margin-top: 80px
        }

        section.sec+section.sec {
            border-top: 1px solid var(--hairline)
        }

        .sechead {
            display: grid;
            grid-template-columns: 190px 1fr;
            gap: 36px;
            align-items: start;
            margin-bottom: 52px
        }

        .sechead h2 {
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.024em;
            line-height: 1.03;
            font-size: clamp(28px, 3.5vw, 45px);
            margin: 0;
            max-width: 19ch;
            text-wrap: balance
        }

        .sechead .sub {
            font-family: var(--body);
            font-weight: 300;
            font-size: 17.5px;
            line-height: 1.55;
            color: var(--ink-soft);
            max-width: 56ch;
            margin: 18px 0 0
        }

        .sechead .mono {
            padding-top: 9px
        }

        @media (max-width:820px) {
            .sechead {
                grid-template-columns: 1fr;
                gap: 14px;
                margin-bottom: 36px
            }

            .sechead .mono {
                padding-top: 0
            }
        }

        /* row lists */
        .rows {
            border-top: 1px solid var(--hairline)
        }

        .row {
            display: grid;
            grid-template-columns: 190px 1fr;
            gap: 36px;
            padding: 26px 0;
            border-bottom: 1px solid var(--hairline);
            align-items: start
        }

        .row h3 {
            font-family: var(--display);
            font-weight: 800;
            font-size: 18px;
            letter-spacing: -.018em;
            margin: 0
        }

        .row .num {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            color: var(--ink-faint);
            padding-top: 4px
        }

        .row p {
            font-family: var(--body);
            font-weight: 300;
            font-size: 16.5px;
            line-height: 1.6;
            color: var(--ink-soft);
            margin: 9px 0 0;
            max-width: 66ch
        }

        .row .rt {
            display: grid;
            grid-template-columns: 1fr 1.25fr;
            gap: 36px;
            align-items: start
        }

        @media (max-width:900px) {
            .row {
                grid-template-columns: 1fr;
                gap: 6px
            }

            .row .rt {
                grid-template-columns: 1fr;
                gap: 0
            }
        }

        /* services inline list */
        .chips {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            border-top: 1px solid var(--hairline)
        }

        .chip {
            padding: 22px 22px 24px;
            border-bottom: 1px solid var(--hairline);
            border-left: 1px solid var(--hairline)
        }

        .chip:nth-child(4n+1) {
            border-left: 0;
            padding-left: 0
        }

        .chip strong {
            display: block;
            font-weight: 800;
            font-size: 15.5px;
            letter-spacing: -.012em
        }

        .chip span {
            display: block;
            margin-top: 6px;
            font-family: var(--body);
            font-weight: 300;
            font-size: 15px;
            line-height: 1.5;
            color: var(--ink-soft)
        }

        @media (max-width:1000px) {
            .chips {
                grid-template-columns: repeat(2, 1fr)
            }

            .chip:nth-child(4n+1) {
                border-left: 1px solid var(--hairline);
                padding-left: 22px
            }

            .chip:nth-child(odd) {
                border-left: 0;
                padding-left: 0
            }
        }

        @media (max-width:640px) {
            .chips {
                grid-template-columns: 1fr
            }

            .chip {
                border-left: 0;
                padding-left: 0
            }

            .chip:nth-child(4n+1) {
                border-left: 0;
                padding-left: 0
            }
        }

        /* two-column use cases */
        .two {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0
        }

        .two>div {
            padding-right: 40px
        }

        .two>div+div {
            border-left: 1px solid var(--hairline);
            padding-left: 40px;
            padding-right: 0
        }

        .two h4 {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint);
            margin: 0 0 4px;
            padding-bottom: 14px;
            border-bottom: 1px solid var(--hairline)
        }

        .two ul {
            list-style: none;
            margin: 0;
            padding: 0
        }

        .two li {
            border-bottom: 1px solid var(--hairline);
            padding: 15px 0;
            font-size: 15.5px;
            letter-spacing: -.008em;
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 16px;
            align-items: baseline
        }

        .two li i {
            font-style: normal;
            font-family: var(--body);
            font-weight: 300;
            font-size: 14.5px;
            color: var(--ink-faint);
            text-align: right
        }

        @media (max-width:820px) {
            .two {
                grid-template-columns: 1fr
            }

            .two>div {
                padding-right: 0
            }

            .two>div+div {
                border-left: 0;
                padding-left: 0;
                margin-top: 44px
            }
        }

        /* case studies */
        .cases {
            border-top: 1px solid var(--hairline)
        }

        .case {
            display: grid;
            grid-template-columns: 1fr 1.2fr;
            gap: 40px;
            padding: 30px 0;
            border-bottom: 1px solid var(--hairline);
            align-items: start
        }

        .case .cat {
            margin: 0 0 10px
        }

        .case h3 {
            font-family: var(--display);
            font-weight: 800;
            font-size: clamp(20px, 2.1vw, 26px);
            letter-spacing: -.028em;
            line-height: 1.1;
            margin: 0;
            max-width: 17ch;
            text-wrap: balance;
            font-variant-numeric: tabular-nums
        }

        .case .note {
            font-family: var(--body);
            font-weight: 300;
            font-size: 15.5px;
            line-height: 1.55;
            color: var(--ink-soft);
            margin: 12px 0 0;
            max-width: 44ch
        }

        .metrics {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            margin: 0;
            border-top: 1px solid var(--hairline)
        }

        .metrics>div {
            padding: 14px 18px 14px 0;
            border-bottom: 1px solid var(--hairline)
        }

        .metrics>div:nth-child(even) {
            border-left: 1px solid var(--hairline);
            padding-left: 18px
        }

        .metrics>div:nth-last-child(-n+2) {
            border-bottom: 0
        }

        .metrics dt {
            font-family: var(--mono);
            font-size: 10.5px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: var(--ink-faint);
            margin: 0
        }

        .metrics dd {
            margin: 7px 0 0;
            font-family: var(--display);
            font-weight: 800;
            font-size: 19px;
            letter-spacing: -.022em;
            font-variant-numeric: tabular-nums
        }

        .footnote {
            font-family: var(--body);
            font-weight: 300;
            font-size: 14.5px;
            line-height: 1.6;
            color: var(--ink-faint);
            margin: 22px 0 0;
            max-width: 74ch
        }

        @media (max-width:900px) {
            .case {
                grid-template-columns: 1fr;
                gap: 20px
            }

            .metrics {
                margin-top: 2px
            }
        }

        @media (max-width:520px) {
            .metrics {
                grid-template-columns: 1fr
            }

            .metrics>div:nth-child(even) {
                border-left: 0;
                padding-left: 0
            }

            .metrics>div:nth-last-child(-n+2) {
                border-bottom: 1px solid var(--hairline)
            }

            .metrics>div:last-child {
                border-bottom: 0
            }
        }

        /* the work: inverted full-bleed reel */
        .work {
            background: var(--ink);
            color: #EDEDEB;
            padding: 78px 0 72px;
            position: relative;
            z-index: 1;
            border-top: 1px solid var(--hairline)
        }

        .work .sechead h2 {
            color: #F5F5F3
        }

        .work .sechead .mono {
            color: #8D9096
        }

        .work .sechead .sub {
            color: #A9ABAF
        }

        .reelwrap {
            overflow-x: auto;
            overflow-y: hidden;
            margin-top: 6px;
            -webkit-overflow-scrolling: touch
        }

        .reel {
            display: flex;
            gap: 14px;
            width: max-content;
            padding: 2px max(var(--pad), calc((100vw - var(--wrap))/2 + var(--pad))) 18px
        }

        .tile {
            flex: 0 0 206px;
            aspect-ratio: 9/16;
            background: #17181B;
            border: 1px solid rgba(255, 255, 255, .13);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 15px;
            position: relative;
            overflow: hidden
        }

        .tile video {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            z-index: 0
        }

        .tile .tl,
        .tile .tb {
            position: relative;
            z-index: 1
        }

        .tile .tl {
            font-family: var(--mono);
            font-size: 9.5px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: #8D9096
        }

        .tile .tb b {
            display: block;
            font-family: var(--display);
            font-weight: 800;
            font-size: 21px;
            letter-spacing: -.028em;
            color: #F5F5F3;
            font-variant-numeric: tabular-nums
        }

        .tile .tb span {
            display: block;
            margin-top: 5px;
            font-family: var(--mono);
            font-size: 9.5px;
            letter-spacing: .11em;
            text-transform: uppercase;
            color: #70747B
        }

        .work .footnote {
            color: #75787E;
            padding-inline: var(--pad);
            max-width: calc(var(--wrap) - var(--pad)*2);
            margin-inline: auto
        }

        @media (min-width:1265px) {
            .work .footnote {
                padding-inline: 0
            }
        }

        /* engagement model */
        .model {
            display: grid;
            grid-template-columns: .9fr 1.1fr;
            gap: 0;
            border-top: 1px solid var(--hairline)
        }

        .model>div {
            padding: 26px 40px 26px 0
        }

        .model>div+div {
            border-left: 1px solid var(--hairline);
            padding: 26px 0 26px 40px
        }

        .model h4 {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint);
            margin: 0 0 18px
        }

        .spec {
            margin: 0
        }

        .spec div {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 18px;
            padding: 12px 0;
            border-bottom: 1px solid var(--hairline);
            align-items: baseline
        }

        .spec div:last-child {
            border-bottom: 0
        }

        .spec dt {
            margin: 0;
            font-family: var(--body);
            font-weight: 300;
            font-size: 15.5px;
            color: var(--ink-soft)
        }

        .spec dd {
            margin: 0;
            font-weight: 800;
            font-size: 15.5px;
            letter-spacing: -.012em;
            text-align: right;
            font-variant-numeric: tabular-nums;
            line-height: 1.35
        }

        .phase {
            display: grid;
            grid-template-columns: 132px 1fr;
            gap: 24px;
            padding: 16px 0;
            border-bottom: 1px solid var(--hairline);
            align-items: start
        }

        .phase:last-child {
            border-bottom: 0
        }

        .phase b {
            font-family: var(--mono);
            font-size: 10.5px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: var(--ink-faint);
            padding-top: 3px
        }

        .phase p {
            margin: 0;
            font-family: var(--body);
            font-weight: 300;
            font-size: 15.5px;
            line-height: 1.55;
            color: var(--ink-soft)
        }

        @media (max-width:900px) {
            .model {
                grid-template-columns: 1fr
            }

            .model>div {
                padding: 22px 0
            }

            .model>div+div {
                border-left: 0;
                border-top: 1px solid var(--hairline);
                padding: 22px 0
            }

            .phase {
                grid-template-columns: 1fr;
                gap: 5px
            }
        }

        /* reusable inverted section */
        .sec.dark {
            background: var(--ink);
            color: #EDEDEB;
            border-top: 1px solid var(--hairline)
        }

        .sec.dark .sechead h2 {
            color: #F7F7F5
        }

        .sec.dark .sechead .mono {
            color: #8D9096
        }

        .sec.dark .sechead .sub {
            color: #A9ABAF
        }

        .sec.dark .qa {
            border-top: 1px solid rgba(255, 255, 255, .5)
        }

        .sec.dark .qa>div {
            border-bottom: 1px solid rgba(255, 255, 255, .14)
        }

        .sec.dark .qa h3 {
            color: #F7F7F5
        }

        .sec.dark .qa p {
            color: #A2A5AA
        }

        /* questions */
        .qa {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0 52px;
            border-top: 1px solid var(--hairline)
        }

        .qa>div {
            padding: 19px 0;
            border-bottom: 1px solid var(--hairline)
        }

        .qa h3 {
            font-family: var(--display);
            font-weight: 800;
            font-size: 16px;
            letter-spacing: -.016em;
            margin: 0
        }

        .qa p {
            font-family: var(--body);
            font-weight: 300;
            font-size: 15.5px;
            line-height: 1.56;
            color: var(--ink-soft);
            margin: 9px 0 0;
            max-width: 52ch
        }

        @media (max-width:820px) {
            .qa {
                grid-template-columns: 1fr;
                gap: 0
            }
        }

        /* the argument */
        .thesis .stmt {
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.026em;
            line-height: 1.04;
            font-size: clamp(29px, 4.5vw, 60px);
            margin: 0;
            max-width: 21ch;
            text-wrap: balance
        }

        .thesis .stmt2 {
            font-family: var(--display);
            font-weight: 500;
            letter-spacing: -.024em;
            line-height: 1.2;
            font-size: clamp(19px, 2.1vw, 27px);
            color: var(--ink-faint);
            margin: 22px 0 0;
            max-width: 34ch;
            text-wrap: balance
        }

        .thesis .after {
            font-family: var(--body);
            font-weight: 300;
            font-size: 17.5px;
            line-height: 1.6;
            color: var(--ink-soft);
            max-width: 58ch;
            margin: 30px 0 0
        }

        .bignum {
            margin-top: 66px;
            border-top: 1px solid var(--hairline);
            padding-top: 24px;
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 40px;
            align-items: end
        }

        .bignum b {
            display: block;
            font-family: var(--display);
            font-weight: 900;
            letter-spacing: -.045em;
            line-height: .86;
            font-size: clamp(44px, 8.1vw, 106px);
            font-variant-numeric: tabular-nums;
            white-space: nowrap
        }

        .bignum p {
            font-family: var(--body);
            font-weight: 300;
            font-size: 17px;
            line-height: 1.55;
            color: var(--ink-soft);
            margin: 0 0 10px;
            max-width: 34ch
        }

        @media (max-width:820px) {
            .bignum {
                grid-template-columns: 1fr;
                gap: 14px;
                align-items: start
            }

            .bignum p {
                margin-bottom: 0
            }

            .bignum b {
                white-space: normal
            }
        }

        /* volume diagram */
        .volume {
            border-top: 1px solid var(--hairline);
            padding-top: 28px;
            margin-bottom: 52px
        }

        .eq {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-end;
            gap: 0 26px
        }

        .eq .term {
            padding-right: 26px
        }

        .eq .term b {
            display: block;
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.03em;
            line-height: 1;
            font-size: clamp(24px, 3vw, 38px);
            font-variant-numeric: tabular-nums
        }

        .eq .term span {
            display: block;
            margin-top: 9px;
            font-family: var(--mono);
            font-size: 10.5px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: var(--ink-faint)
        }

        .eq .op {
            font-family: var(--display);
            font-weight: 400;
            font-size: clamp(20px, 2.4vw, 30px);
            color: var(--ink-faint);
            line-height: 1;
            padding-bottom: 2px
        }

        .eq .term.out b {
            color: var(--ink)
        }

        .vis {
            display: grid;
            grid-template-columns: minmax(0, 700px) 1fr;
            gap: 52px;
            align-items: start;
            margin-top: 34px
        }

        .ticks {
            display: grid;
            grid-template-columns: repeat(25, 1fr);
            gap: 5px
        }

        .ticks i {
            display: block;
            aspect-ratio: 9/16;
            background: rgba(11, 11, 12, .14)
        }

        .ticks i.win {
            background: var(--ink)
        }

        .legend {
            display: flex;
            flex-wrap: wrap;
            gap: 10px 26px;
            margin-top: 20px;
            align-items: center
        }

        .legend span {
            display: flex;
            align-items: center;
            gap: 9px;
            font-family: var(--mono);
            font-size: 10.5px;
            font-weight: 500;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--ink-faint)
        }

        .legend span::before {
            content: "";
            width: 9px;
            height: 16px;
            background: rgba(11, 11, 12, .14);
            flex: none
        }

        .legend span.on::before {
            background: var(--ink)
        }

        .volume .note {
            font-family: var(--body);
            font-weight: 300;
            font-size: 15.5px;
            line-height: 1.62;
            color: var(--ink-soft);
            margin: 0;
            max-width: 40ch
        }

        @media (max-width:1000px) {
            .vis {
                grid-template-columns: 1fr;
                gap: 26px
            }

            .volume .note {
                max-width: 66ch
            }
        }

        @media (max-width:900px) {
            .ticks {
                grid-template-columns: repeat(20, 1fr);
                gap: 4px
            }
        }

        @media (max-width:560px) {
            .ticks {
                grid-template-columns: repeat(10, 1fr);
                gap: 4px
            }

            .eq {
                gap: 0 16px
            }

            .eq .term {
                padding-right: 16px
            }
        }

        /* use cases, inverted */
        .ucdark {
            background: var(--ink);
            color: #F5F5F3;
            padding: 84px 0;
            position: relative;
            z-index: 1;
            border-top: 1px solid var(--hairline)
        }

        .ucdark .sechead h2 {
            color: #F7F7F5
        }

        .ucdark .sechead .mono {
            color: #8D9096
        }

        .ucdark .sechead .sub {
            color: #A9ABAF
        }

        .ucgrid {
            display: grid;
            grid-template-columns: 1.04fr .96fr;
            gap: 56px;
            align-items: start
        }

        .obj {
            border-top: 1px solid rgba(255, 255, 255, .5)
        }

        .obj ul {
            margin: 0;
            padding: 0
        }

        .obj li {
            list-style: none;
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 20px;
            align-items: baseline;
            padding: 15px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .14);
            cursor: default;
            transition: padding-left .22s ease, opacity .22s ease
        }

        .obj li b {
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.026em;
            line-height: 1.15;
            font-size: clamp(18px, 1.85vw, 24px);
            color: #9A9DA3;
            transition: color .22s ease
        }

        .obj li i {
            font-style: normal;
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: #63666C;
            white-space: nowrap;
            transition: color .22s ease
        }

        .obj li.on,
        .obj li:hover {
            padding-left: 12px
        }

        .obj li.on b,
        .obj li:hover b {
            color: #F7F7F5
        }

        .obj li.on i,
        .obj li:hover i {
            color: #9A9DA3
        }

        .panel {
            position: sticky;
            top: 92px;
            border: 1px solid rgba(255, 255, 255, .16);
            background: #131418;
            aspect-ratio: 4/5;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: flex-end
        }

        .panel canvas,
        .panel img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            display: block
        }

        .panel img {
            object-fit: cover
        }

        .panel .cap {
            position: relative;
            z-index: 2;
            padding: 24px;
            background: linear-gradient(to top, rgba(11, 11, 12, .88), rgba(11, 11, 12, 0))
        }

        .panel .cap b {
            display: block;
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.028em;
            font-size: clamp(20px, 2.1vw, 27px);
            line-height: 1.12;
            color: #F7F7F5;
            text-wrap: balance
        }

        .panel .cap span {
            display: block;
            margin-top: 9px;
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .13em;
            text-transform: uppercase;
            color: #9A9DA3
        }

        .ucdark .blockhead {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: #8D9096;
            margin: 0 0 14px
        }

        .cats {
            margin-top: 64px
        }

        .catgrid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            border-top: 1px solid rgba(255, 255, 255, .14)
        }

        .catgrid div {
            padding: 16px 18px 18px;
            border-bottom: 1px solid rgba(255, 255, 255, .14);
            border-left: 1px solid rgba(255, 255, 255, .14)
        }

        .catgrid div:nth-child(5n+1) {
            border-left: 0;
            padding-left: 0
        }

        .catgrid strong {
            display: block;
            font-weight: 800;
            font-size: 14.5px;
            letter-spacing: -.014em;
            line-height: 1.25;
            color: #EDEDEB
        }

        .catgrid span {
            display: block;
            margin-top: 7px;
            font-family: var(--mono);
            font-size: 9.5px;
            font-weight: 500;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: #75787E;
            line-height: 1.4
        }

        @media (max-width:1000px) {
            .ucgrid {
                grid-template-columns: 1fr;
                gap: 36px
            }

            .panel {
                position: relative;
                top: 0;
                aspect-ratio: 16/10;
                order: -1
            }

            .catgrid {
                grid-template-columns: repeat(3, 1fr)
            }

            .catgrid div:nth-child(5n+1) {
                border-left: 1px solid rgba(255, 255, 255, .14);
                padding-left: 18px
            }

            .catgrid div:nth-child(3n+1) {
                border-left: 0;
                padding-left: 0
            }
        }

        @media (max-width:620px) {
            .catgrid {
                grid-template-columns: repeat(2, 1fr)
            }

            .catgrid div:nth-child(3n+1) {
                border-left: 1px solid rgba(255, 255, 255, .14);
                padding-left: 18px
            }

            .catgrid div:nth-child(odd) {
                border-left: 0;
                padding-left: 0
            }

            .obj li {
                grid-template-columns: 1fr;
                gap: 4px
            }
        }

        /* pull quote */
        .pull {
            font-family: var(--display);
            font-weight: 800;
            letter-spacing: -.03em;
            line-height: 1.12;
            font-size: clamp(24px, 3.2vw, 40px);
            max-width: 22ch;
            margin: 0;
            text-wrap: balance
        }

        .pull small {
            display: block;
            margin-top: 20px;
            font-family: var(--body);
            font-weight: 300;
            font-size: 17px;
            letter-spacing: 0;
            line-height: 1.55;
            color: var(--ink-soft);
            max-width: 52ch
        }

        /* contact */
        .contact .wrap {
            display: grid;
            grid-template-columns: 1.05fr .95fr;
            gap: 56px;
            align-items: start
        }

        .contact h2 {
            font-family: var(--display);
            font-weight: 900;
            letter-spacing: -.026em;
            line-height: 1;
            font-size: clamp(34px, 4.6vw, 60px);
            margin: 16px 0 0;
            text-wrap: balance
        }

        .contact p {
            font-family: var(--body);
            font-weight: 300;
            font-size: 17.5px;
            line-height: 1.55;
            color: var(--ink-soft);
            max-width: 46ch;
            margin: 20px 0 0
        }

        .dl {
            border-top: 1px solid var(--hairline);
            margin-top: 4px
        }

        .dl div {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 20px;
            padding: 17px 0;
            border-bottom: 1px solid var(--hairline);
            align-items: baseline
        }

        .dl dt {
            font-family: var(--mono);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint);
            margin: 0
        }

        .dl dd {
            margin: 0;
            font-size: 15.5px;
            letter-spacing: -.008em
        }

        .dl dd a {
            color: var(--ink);
            text-decoration: none;
            border-bottom: 1px solid var(--hairline)
        }

        .dl dd a:hover {
            border-bottom-color: var(--ink)
        }

        @media (max-width:900px) {
            .contact .wrap {
                grid-template-columns: 1fr;
                gap: 36px
            }

            .dl div {
                grid-template-columns: 1fr;
                gap: 4px
            }
        }

        footer {
            position: relative;
            z-index: 1;
            border-top: 1px solid var(--hairline);
            padding: 30px 0 44px
        }

        footer .wrap {
            display: flex;
            flex-wrap: wrap;
            gap: 16px 28px;
            align-items: center
        }

        footer .mono {
            color: var(--ink-faint)
        }

        footer .sp {
            margin-left: auto
        }


        /* ============ rounded / liquid layer ============ */
        body {
            font-family: var(--body);
            font-weight: 400
        }

        /* ambient chrome blobs */
        .blobs {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 0;
            overflow: hidden;
            filter: blur(70px);
            opacity: .5
        }

        .blobs i {
            position: absolute;
            display: block;
            border-radius: 50%;
            background: radial-gradient(circle at 34% 30%, #ffffff 0%, #d3d8df 38%, #9ea4ad 68%, rgba(158, 164, 173, 0) 74%)
        }

        .blobs i:nth-child(1) {
            width: 46vw;
            height: 46vw;
            left: -12vw;
            top: -8vw;
            animation: drift1 26s ease-in-out infinite alternate
        }

        .blobs i:nth-child(2) {
            width: 34vw;
            height: 34vw;
            right: -8vw;
            top: 38vh;
            animation: drift2 32s ease-in-out infinite alternate
        }

        .blobs i:nth-child(3) {
            width: 28vw;
            height: 28vw;
            left: 24vw;
            bottom: -10vw;
            animation: drift1 38s ease-in-out infinite alternate-reverse
        }

        @keyframes drift1 {
            to {
                transform: translate3d(7vw, 5vh, 0) scale(1.14)
            }
        }

        @keyframes drift2 {
            to {
                transform: translate3d(-6vw, -7vh, 0) scale(.88)
            }
        }

        /* pills */
        .btn {
            border-radius: var(--pill);
            padding: 13px 24px;
            border-width: 1.5px;
            transition: transform .4s var(--ease), background .2s ease, color .2s ease, box-shadow .3s ease
        }

        .btn:hover {
            transform: translateY(-2px) scale(1.035);
            box-shadow: 0 12px 26px -14px rgba(11, 11, 12, .6)
        }

        .mark span.ring {
            width: 16px;
            height: 16px;
            box-shadow: inset 0 0 0 4px var(--ground)
        }

        header.nav {
            border-bottom: 0;
            background: color-mix(in srgb, var(--ground) 78%, transparent);
            backdrop-filter: saturate(1.4) blur(16px)
        }

        .nav nav a {
            border-radius: var(--pill);
            padding: 7px 12px;
            transition: background .22s ease, color .22s ease
        }

        .nav nav a:hover {
            background: rgba(11, 11, 12, .07)
        }

        a:focus-visible,
        button:focus-visible,
        .obj li:focus-visible {
            outline: 2.5px solid var(--ink);
            outline-offset: 4px;
            border-radius: 8px
        }

        /* fact strip becomes a floating slab */
        .facts {
            background: transparent;
            border: 0;
            padding: 6px 0 4px
        }

        .facts .wrap {
            background: var(--ground-2);
            border-radius: var(--r-lg);
            padding: 10px 30px;
            box-shadow: inset 0 0 0 1px rgba(11, 11, 12, .06)
        }

        .fact {
            padding: 24px 22px
        }

        .fact:first-child {
            padding-left: 22px
        }

        @media (max-width:820px) {
            .facts .wrap {
                padding: 6px 20px
            }
        }

        /* dark sections become inset rounded slabs */
        .work,
        .ucdark,
        .sec.dark {
            border-top: 0;
            border-radius: var(--r-xl);
            margin-inline: var(--slab-gap);
            box-shadow: var(--soft);
            overflow: hidden
        }

        section.sec+section.sec {
            border-top: 0
        }

        section.sec+section.sec::before {
            content: "";
            display: block;
            position: absolute;
            top: 0;
            left: var(--pad);
            right: var(--pad);
            height: 1px;
            background: var(--hairline);
            max-width: calc(var(--wrap) - var(--pad)*2);
            margin-inline: auto
        }

        .sec.dark::before,
        .work+.sec::before,
        .ucdark+.sec::before {
            display: none
        }

        .sec.dark {
            padding: 78px 0
        }

        .work {
            padding: 74px 0 66px
        }

        .ucdark {
            padding: 80px 0
        }

        @media (max-width:640px) {

            .work,
            .ucdark,
            .sec.dark {
                border-radius: var(--r-lg);
                margin-inline: 12px
            }
        }

        /* reel tiles */
        .reel {
            padding: 2px 44px 20px
        }

        .tile {
            border-radius: var(--r);
            flex: 0 0 214px;
            transition: transform .45s var(--ease), border-color .3s ease
        }

        .tile:hover {
            transform: translateY(-8px) scale(1.025);
            border-color: rgba(255, 255, 255, .3)
        }

        @media (max-width:640px) {
            .reel {
                padding-inline: 20px
            }
        }

        /* use case panel + list */
        .panel {
            border-radius: var(--r-lg)
        }

        .obj li {
            border-radius: var(--pill);
            padding-left: 16px;
            padding-right: 16px;
            transition: background .28s ease, padding-left .3s var(--ease), color .28s ease
        }

        .obj li.on,
        .obj li:hover {
            padding-left: 26px;
            background: rgba(255, 255, 255, .07)
        }

        .obj {
            border-top: 0
        }

        .obj li {
            border-bottom: 0
        }

        .obj ul {
            display: flex;
            flex-direction: column;
            gap: 2px
        }

        /* tick marks */
        .ticks i {
            border-radius: 4px
        }

        .legend span::before {
            border-radius: 3px
        }

        /* soften the remaining panels */
        .chips {
            border-radius: var(--r);
            overflow: hidden;
            background: rgba(11, 11, 12, .035);
            border-top: 0
        }

        .chip {
            border-bottom: 0;
            border-left: 0;
            padding: 24px
        }

        .chip:nth-child(4n+1) {
            padding-left: 24px
        }

        .chip {
            box-shadow: inset 0 0 0 1px rgba(11, 11, 12, .055)
        }

        .catgrid {
            border-top: 0;
            gap: 6px
        }

        .catgrid div {
            border: 0;
            border-radius: var(--r-sm);
            background: rgba(255, 255, 255, .05);
            padding: 16px 18px
        }

        .catgrid div:nth-child(5n+1) {
            padding-left: 18px
        }

        .metrics>div,
        .spec div,
        .qa>div,
        .row,
        .case,
        .obj li {
            border-color: rgba(11, 11, 12, .1)
        }

        .sec.dark .qa>div {
            border-bottom: 0
        }

        .sec.dark .qa {
            border-top: 0
        }

        .sec.dark .qa>div {
            background: rgba(255, 255, 255, .05);
            border-radius: var(--r);
            padding: 22px 24px;
            margin-bottom: 12px
        }

        .qa {
            gap: 0 16px
        }

        /* engagement model panels */
        .model {
            border-top: 0;
            gap: 20px
        }

        .model>div {
            background: rgba(11, 11, 12, .035);
            border-radius: var(--r);
            padding: 26px 28px 28px;
            box-shadow: inset 0 0 0 1px rgba(11, 11, 12, .055)
        }

        .model>div+div {
            border-left: 0;
            padding: 26px 28px 28px
        }

        .spec div:last-child {
            border-bottom: 0
        }

        /* results */
        .case {
            border-radius: var(--r-lg);
            padding: 28px 4px
        }

        .cases {
            border-top: 0
        }

        /* hero ring, larger and floating */
        .ringwrap {
            max-width: 500px
        }

        @keyframes bob {

            0%,
            100% {
                transform: translateY(0)
            }

            50% {
                transform: translateY(-16px)
            }
        }

        #ring {
            animation: bob 9s ease-in-out infinite
        }



        /* method: compress */
        #method {
            padding: 70px 0
        }

        #method .sechead {
            margin-bottom: 38px
        }

        #method .volume {
            padding-top: 22px;
            margin-bottom: 38px
        }

        #method .eq .term b {
            font-size: clamp(20px, 2.2vw, 28px)
        }

        #method .eq .term span {
            margin-top: 7px
        }

        #method .vis {
            grid-template-columns: minmax(0, 470px) 1fr;
            gap: 40px;
            margin-top: 24px
        }

        #method .ticks {
            gap: 4px
        }

        #method .volume .note {
            font-size: 14.5px;
            line-height: 1.55;
            max-width: 38ch
        }

        #method .legend {
            margin-top: 14px
        }

        #method .rows {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0 44px;
            border-top: 0
        }

        #method .row {
            grid-template-columns: 1fr;
            gap: 5px;
            padding: 18px 0;
            align-content: start
        }

        #method .row .rt {
            grid-template-columns: 1fr;
            gap: 0
        }

        #method .row h3 {
            font-size: 16.5px
        }

        #method .row p {
            font-size: 15px;
            line-height: 1.55;
            margin-top: 7px;
            max-width: 46ch
        }

        #method .row .num {
            padding-top: 0;
            margin-bottom: 2px
        }

        @media (max-width:820px) {
            #method .rows {
                grid-template-columns: 1fr
            }

            #method .vis {
                grid-template-columns: 1fr;
                gap: 22px
            }
        }



        /* real mark */
        .ringwrap {
            max-width: 430px;
            display: flex;
            align-items: center;
            justify-content: center;
            aspect-ratio: auto
        }

        #ring {
            width: 100%;
            height: auto;
            display: block;
            filter: drop-shadow(0 30px 50px rgba(11, 11, 12, .22));
            animation: markfloat 11s ease-in-out infinite
        }

        @keyframes markfloat {

            0%,
            100% {
                transform: translateY(0) rotate(0deg) scale(1)
            }

            50% {
                transform: translateY(-20px) rotate(-3.5deg) scale(1.035)
            }
        }

        .mark .ringmark {
            width: 26px;
            height: auto;
            display: block;
            margin-right: 2px
        }

        .mark {
            gap: 8px;
            font-size: 18px
        }

        @media (max-width:900px) {
            .ringwrap {
                max-width: 210px
            }
        }



        /* proof frame in the argument */
        .argrid {
            display: grid;
            grid-template-columns: 1.06fr .94fr;
            gap: 56px;
            align-items: center
        }

        .proof {
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 18px
        }

        .phone {
            position: relative;
            width: 100%;
            max-width: 296px;
            aspect-ratio: 9/19.5;
            border-radius: 36px;
            background: linear-gradient(152deg, #dfe2e6 0%, #f6f7f8 22%, #b9bec5 46%, #8f959d 62%, #e9ebee 82%, #c4c9d0 100%);
            box-shadow: 0 40px 70px -34px rgba(11, 11, 12, .55), inset 0 0 0 1px rgba(11, 11, 12, .12);
            overflow: hidden;
            transform: rotate(-3.2deg);
            transition: transform .6s var(--ease), box-shadow .5s ease
        }

        .phone:hover {
            transform: rotate(0deg) translateY(-6px) scale(1.02);
            box-shadow: 0 52px 84px -34px rgba(11, 11, 12, .6), inset 0 0 0 1px rgba(11, 11, 12, .14)
        }

        .phone img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block
        }

        .phone .ph {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            text-align: center;
            padding: 26px
        }

        .phone .ph b {
            font-family: var(--display);
            font-weight: 900;
            font-size: 44px;
            letter-spacing: -.04em;
            line-height: .9;
            color: rgba(11, 11, 12, .72)
        }

        .phone .ph span {
            font-family: var(--mono);
            font-size: 9.5px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: rgba(11, 11, 12, .5);
            line-height: 1.7
        }

        .proof figcaption {
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint);
            text-align: center
        }

        @media (max-width:900px) {
            .argrid {
                grid-template-columns: 1fr;
                gap: 44px
            }

            .proof {
                order: -1;
                align-items: flex-start
            }

            .phone {
                transform: rotate(-2deg)
            }
        }



        /* volume: equation only, as a soft panel */
        #method .volume {
            border-top: 0;
            background: rgba(11, 11, 12, .035);
            border-radius: var(--r);
            box-shadow: inset 0 0 0 1px rgba(11, 11, 12, .055);
            padding: 30px 32px 30px;
            margin-bottom: 34px
        }

        #method .eq {
            align-items: flex-end;
            gap: 0
        }

        #method .eq .term {
            padding-right: 30px;
            flex: 1 1 auto
        }

        #method .eq .term+.op {
            padding-right: 30px
        }

        #method .eq .term b {
            font-size: clamp(26px, 3.4vw, 44px);
            line-height: .95
        }

        #method .eq .term span {
            margin-top: 11px
        }

        #method .eq .op {
            font-size: clamp(20px, 2.4vw, 30px);
            padding-bottom: 6px
        }

        #method .volume .note {
            margin: 24px 0 0;
            max-width: 74ch;
            font-size: 15px;
            color: var(--ink-soft);
            padding-top: 20px;
            border-top: 1px solid var(--hairline)
        }

        @media (max-width:700px) {
            #method .eq {
                gap: 14px 0
            }

            #method .eq .term {
                flex: 1 1 100%;
                padding-right: 0
            }

            #method .eq .op {
                display: none
            }

            #method .volume {
                padding: 24px
            }
        }

        /* contact-sheet slot, ready for real stills */
        .sheet {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 6px;
            margin-top: 26px
        }

        .sheet img {
            width: 100%;
            aspect-ratio: 9/16;
            object-fit: cover;
            border-radius: 6px;
            display: block
        }

        @media (max-width:900px) {
            .sheet {
                grid-template-columns: repeat(8, 1fr)
            }
        }

        @media (max-width:560px) {
            .sheet {
                grid-template-columns: repeat(5, 1fr)
            }
        }



        /* forms */
        .form {
            display: grid;
            gap: 14px;
            margin-top: 26px
        }

        .frow {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px
        }

        .field {
            display: flex;
            flex-direction: column;
            gap: 7px
        }

        .field label {
            font-family: var(--mono);
            font-size: 10px;
            font-weight: 500;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--ink-faint)
        }

        .field input,
        .field textarea,
        .field select {
            font-family: var(--body);
            font-size: 15.5px;
            font-weight: 400;
            color: var(--ink);
            background: rgba(255, 255, 255, .55);
            border: 1.5px solid rgba(11, 11, 12, .13);
            border-radius: var(--r-sm);
            padding: 13px 15px;
            width: 100%;
            transition: border-color .2s ease, background .2s ease, box-shadow .2s ease
        }

        .field textarea {
            min-height: 112px;
            resize: vertical;
            line-height: 1.5
        }

        .field input:focus,
        .field textarea:focus,
        .field select:focus {
            outline: none;
            border-color: var(--ink);
            background: #fff;
            box-shadow: 0 0 0 4px rgba(11, 11, 12, .07)
        }

        .field input::placeholder,
        .field textarea::placeholder {
            color: var(--ink-faint)
        }

        .form button {
            justify-self: start;
            margin-top: 4px;
            border: 1.5px solid var(--ink);
            cursor: pointer
        }

        .hp {
            position: absolute;
            left: -9999px;
            width: 1px;
            height: 1px;
            overflow: hidden
        }

        .formnote {
            font-family: var(--body);
            font-weight: 300;
            font-size: 13.5px;
            color: var(--ink-faint);
            margin: 2px 0 0
        }

        @media (max-width:640px) {
            .frow {
                grid-template-columns: 1fr
            }
        }

/* portal entry: Sign in stays visible on phones; the hero already offers Book a call */
.nav .signin{white-space:nowrap}
@media (max-width:480px){.nav nav a.nav-book{display:none}}
`;

export default LANDING_CSS;
