---
marp: true
theme: tsutawaru-academic
paginate: true
size: 16:9
lang: en
header: '<div class="hdr-left">Hydrogen in the Earth’s Core</div><img class="hdr-logo" src="../assets/logo-placeholder.png" alt="Logo">'
footer: ''
style: |
  :root {
    --measure: 42em;   /* line length: 16:9 leaves room on the right, so widen 28em to 42em */
  }
---

<!-- _class: cover-hero -->
<!-- _paginate: false -->

<div class="title-hero">
<div class="title-small">Sample deck</div>
<div class="title-big long">Hydrogen in the Earth’s Core</div>
<div class="title-sub">Ultra-high-pressure experiments on core formation and the origin of the ocean’s volume</div>
</div>

<div class="title-foot">
<div class="title-photo"><img src="../assets/profile-placeholder.png" alt="Photo"></div>
<div class="title-meta">
<div class="title-name">Shoh Tagawa</div>
<div class="title-affil">Based on: Tagawa S. “Chikyū chūshinkaku no suiso” [Hydrogen in the Earth’s core]. Isotope News 2022;(780):26–30 [in Japanese]</div>
</div>
</div>

<!--
Sample deck for marp-GUI. Text and numbers follow the source article; every figure was drawn for this deck.
-->

---

## Why is the ocean the size it is?

- **The oceans are only 0.023% of Earth’s mass**
  This small amount gives a planet of land and sea its character.
- **Theory suggests tens to a hundred times as much water**
  Recent planet-formation theory has repeatedly pointed to large amounts of delivered water.
- **Low by chance, or regulated?**
  Debate continues over whether a mechanism “regulated” the amount of ocean water.

<div class="takeaway">We focus on the reaction between the core and water as the core formed</div>

---

<!-- _class: lay-fig-left -->

## We study the deep Earth with seismic waves and experiments

<svg viewBox="0 0 600 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Quarter cross-section of today’s Earth: mantle to 2,890 km, outer core to 5,150 km, inner core to 6,370 km"><path d="M110 430L470 430A360 360 0 0 0 110 70Z" fill="var(--rule, #D6D6D6)"/><path d="M110 430L306.7 430A196.7 196.7 0 0 0 110 233.3Z" fill="var(--accent, #A6192E)"/><path d="M110 430L179 430A69 69 0 0 0 110 361Z" fill="var(--accent-dark, #7D1322)"/><path d="M179 430A69 69 0 0 0 110 361" fill="none" stroke="#fff" stroke-width="2"/><path d="M110 70V430M100 70H110M100 233.3H110M100 361H110M100 430H110" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="94" y="40" font-size="20" font-weight="700" text-anchor="end" fill="var(--ink, #262626)">Depth</text><text x="94" y="77" font-size="20" text-anchor="end" fill="var(--ink, #262626)">0 km</text><text x="94" y="240" font-size="20" text-anchor="end" fill="var(--ink, #262626)">2,890 km</text><text x="94" y="368" font-size="20" text-anchor="end" fill="var(--ink, #262626)">5,150 km</text><text x="94" y="437" font-size="20" text-anchor="end" fill="var(--ink, #262626)">6,370 km</text><text x="300" y="226" font-size="22" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">Mantle</text><text x="300" y="254" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">solid rock</text><text x="200" y="330" font-size="22" font-weight="700" text-anchor="middle" fill="#fff">Outer core</text><text x="200" y="356" font-size="20" text-anchor="middle" fill="#fff">liquid metal</text><text x="110" y="462" font-size="20" fill="var(--ink, #262626)"><tspan font-weight="700">Inner core</tspan> solid metal</text></svg>

- The deepest hole ever drilled is 12 km
- Seismic waves reveal density and layering
- Candidate materials are tested under the conditions at that depth

<div class="attr">Redrawn after Tagawa (2022), Fig. 1 (p.26)</div>

---

<!-- _class: lay-fig-right -->

## The core formed as metal separated from a magma ocean

<svg viewBox="0 0 600 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wedge of the early Earth: magma ocean on top, solidified mantle, separated core; metal drops sink toward the core; equilibrium at the base of the magma ocean"><defs><marker id="hyd-en-f2-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10Z" fill="var(--ink, #262626)"/></marker></defs><path d="M300 490L29.1 143.3A440 440 0 0 1 570.9 143.3Z" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><path d="M300 490L96.8 230A330 330 0 0 1 503.2 230Z" fill="var(--rule, #D6D6D6)"/><path d="M300 490L195.3 356A170 170 0 0 1 404.7 356Z" fill="var(--accent, #A6192E)"/><path d="M96.8 230A330 330 0 0 1 503.2 230" fill="none" stroke="var(--ink, #262626)" stroke-width="2" stroke-dasharray="8 6"/><circle cx="548" cy="56" r="16" fill="var(--ink-weak, #6E6E6E)"/><path d="M562 46L592 24M556 38L580 16M568 56L596 42" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2" stroke-linecap="round"/><text x="526" y="38" font-size="20" text-anchor="end" fill="var(--ink, #262626)">Impactor</text><text x="300" y="112" font-size="20" text-anchor="middle" fill="var(--ink, #262626)"><tspan font-weight="700">Magma ocean</tspan> (liquid)</text><path d="M345 173C349 185 359 193 359 201A14 14 0 0 1 331 201C331 193 341 185 345 173Z" fill="var(--accent-dark, #7D1322)"/><path d="M395 183C399 195 409 203 409 211A14 14 0 0 1 381 211C381 203 391 195 395 183Z" fill="var(--accent-dark, #7D1322)"/><path d="M445 203C449 215 459 223 459 231A14 14 0 0 1 431 231C431 223 441 215 445 203Z" fill="var(--accent-dark, #7D1322)"/><path d="M341 223L333 277M386 232L369 284M432 250L405 298" fill="none" stroke="var(--ink, #262626)" stroke-width="3" marker-end="url(#hyd-en-f2-ah)"/><text x="478" y="304" font-size="20" fill="var(--ink, #262626)"><tspan x="478">Metal sinks</tspan><tspan x="478" dy="24">to the core</tspan></text><text x="225" y="284" font-size="20" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)"><tspan x="225">Solidified</tspan><tspan x="225" dy="24">mantle</tspan></text><text x="300" y="392" font-size="20" font-weight="700" text-anchor="middle" fill="#fff"><tspan x="300">Separated</tspan><tspan x="300" dy="24">core</tspan></text><path d="M60 280L116 214" fill="none" stroke="var(--ink, #262626)" stroke-width="1.5"/><text x="6" y="302" font-size="20" fill="var(--ink, #262626)"><tspan x="6" font-weight="700">Equilibrium</tspan><tspan x="6" dy="26">≈ 500,000 atm</tspan><tspan x="6" dy="26">≈ 3,500 K</tspan></text></svg>

- Metal from colliding bodies sinks through the magma ocean
- On the way, chemical reactions partition elements into the core
- Equilibrium at about 500,000 atm and 3,500 K

<div class="attr">Redrawn after Tagawa (2022), Fig. 2 (p.27)</div>

---

<!-- _class: lay-cards3 -->

## The core contains elements lighter than iron

- **About 8% lighter**
  The core is less dense than pure iron at the same pressure and temperature.
- **Unsolved for about 70 years**
  This is known as the core density deficit problem.
- **Hydrogen alone: nearly 100 oceans of water**
  Candidates are Si, O, C, S and H. Here we focus on hydrogen.

<div class="takeaway">Fe (metal) + H₂O (magma) ⇄ FeO (magma) + 2H (metal)</div>

---

<!-- _class: lay-keyrow -->

## Previous studies reached opposite results

- **Enters the core easily**
  Okuchi (1997), but at pressures below core formation.
- **Does not enter the core**
  Clesi et al. (2018), Malavergne et al. (2019).
- **A follow-up was needed**
  Experiments at core-formation conditions were required.

<div class="takeaway">We measure the partition coefficient directly at core-formation conditions</div>

---

<!-- _class: lay-fig-right -->

## Diamonds recreate the deep Earth

<svg viewBox="0 0 600 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diamond anvil cell, not to scale: two diamonds tip to tip squeeze a rhenium gasket whose chamber holds iron foil in hydrous glass; a heating laser and X-rays pass through the diamonds"><path d="M200 10V48" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="8"/><path d="M186 46H214L200 66Z" fill="var(--ink-weak, #6E6E6E)"/><path d="M200 430V384" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="8"/><path d="M186 386H214L200 366Z" fill="var(--ink-weak, #6E6E6E)"/><text x="184" y="36" font-size="20" text-anchor="end" fill="var(--ink, #262626)">Load</text><path d="M175 70H425L348 196H252Z" fill="var(--fill-2, #FAFAFA)" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/><path d="M252 232H348L425 358H175Z" fill="var(--fill-2, #FAFAFA)" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2"/><path d="M120 196H262V232H120ZM338 196H480V232H338Z" fill="var(--ink-weak, #6E6E6E)"/><rect x="262" y="196" width="76" height="36" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><rect x="276" y="209" width="48" height="10" fill="var(--accent-dark, #7D1322)"/><path d="M300 8V186" fill="none" stroke="var(--accent, #A6192E)" stroke-width="4"/><path d="M290 184H310L300 204Z" fill="var(--accent, #A6192E)"/><path d="M300 432V248" fill="none" stroke="var(--ink, #262626)" stroke-width="4"/><path d="M290 250H310L300 230Z" fill="var(--ink, #262626)"/><text x="312" y="30" font-size="20" font-weight="700" fill="var(--accent-dark, #7D1322)">Heating laser</text><text x="312" y="426" font-size="20" font-weight="700" fill="var(--ink, #262626)">X-ray (SPring-8)</text><text x="112" y="221" font-size="20" text-anchor="end" fill="var(--ink, #262626)">Re gasket</text><path d="M405 100L470 88M324 212L482 150M332 228L482 290" fill="none" stroke="var(--ink, #262626)" stroke-width="1.5"/><text x="476" y="92" font-size="20" fill="var(--ink, #262626)">Diamond</text><text x="488" y="156" font-size="20" fill="var(--ink, #262626)">Fe foil</text><text x="488" y="296" font-size="20" fill="var(--ink, #262626)"><tspan x="488">Hydrous</tspan><tspan x="488" dy="24">glass</tspan></text></svg>

- Iron foil and water-bearing glass are squeezed between diamonds
- A laser heats them to about 3,100–4,600 K, then they are quenched
- X-rays at SPring-8 give the hydrogen content from the expansion of iron

<div class="attr">Redrawn after Tagawa (2022), Figs. 3 and 4 (p.28); not to scale</div>

<div class="takeaway">A device 5 cm across reaches the conditions at Earth’s centre</div>

---

<!-- _class: lay-fig-left -->

## Measuring water in a 20 µm sample

<svg viewBox="0 0 600 450" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Three steps: a 20 µm sample cross-section, the isotope microscope (imaging SIMS) in which each pixel works as a detector, and the isotope image that shows the water distribution"><rect x="0" y="0" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><rect x="24" y="23" width="70" height="70" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><circle cx="59" cy="58" r="15" fill="var(--accent-dark, #7D1322)"/><text x="120" y="50" font-size="22" font-weight="700" fill="var(--ink, #262626)">Sample cross-section</text><text x="120" y="84" font-size="20" fill="var(--ink, #262626)">About 20 µm across</text><path d="M276 126H324L300 152Z" fill="var(--accent, #A6192E)"/><rect x="0" y="162" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><path d="M24 185H94V255H24ZM41.5 185V255M59 185V255M76.5 185V255M24 202.5H94M24 220H94M24 237.5H94" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="120" y="212" font-size="22" font-weight="700" fill="var(--ink, #262626)">Isotope microscope (imaging SIMS)</text><text x="120" y="246" font-size="20" fill="var(--ink, #262626)">Each pixel works as a detector</text><path d="M276 288H324L300 314Z" fill="var(--accent, #A6192E)"/><rect x="0" y="324" width="600" height="116" rx="3" fill="var(--fill, #F1F1F1)"/><rect x="24" y="347" width="70" height="70" fill="var(--accent, #A6192E)" fill-opacity="0.25"/><path d="M24 347H94V417H24ZM41.5 347V417M59 347V417M76.5 347V417M24 364.5H94M24 382H94M24 399.5H94" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="120" y="374" font-size="22" font-weight="700" fill="var(--ink, #262626)">Isotope image</text><text x="120" y="408" font-size="20" fill="var(--ink, #262626)">Shows the water distribution in the section</text></svg>

- Hydrogen had almost never been measured in samples this small
- We use the isotope microscope (imaging SIMS) at Hokkaido University
- The image itself is the quantitative result

<div class="attr">Redrawn after Tagawa (2022), Fig. 6 (p.29); schematic, no measured data</div>

---

<!-- _class: lay-fig-right -->

## Hydrogen partitions strongly into the core

<svg viewBox="0 0 600 370" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schematic log axis of the partition coefficient from 0.1 to 100; a dashed line at 1 means no preference; this study’s range 29 to 57 lies far on the metal side"><path d="M213.3 30V240" fill="none" stroke="var(--ink-weak, #6E6E6E)" stroke-width="2" stroke-dasharray="7 5"/><text x="203" y="50" font-size="20" text-anchor="end" fill="var(--ink, #262626)">D<tspan dy="5" font-size="18">H</tspan><tspan dy="-5"> = 1</tspan></text><text x="203" y="76" font-size="20" text-anchor="end" fill="var(--ink, #262626)">no preference</text><text x="492.3" y="138" font-size="22" font-weight="700" text-anchor="middle" fill="var(--accent-dark, #7D1322)">29–57</text><rect x="466.8" y="150" width="50.9" height="56" fill="var(--accent, #A6192E)"/><text x="456" y="166" font-size="22" font-weight="700" text-anchor="end" fill="var(--accent-dark, #7D1322)">This study</text><text x="456" y="192" font-size="20" text-anchor="end" fill="var(--ink, #262626)">300,000–600,000 atm</text><text x="456" y="216" font-size="20" text-anchor="end" fill="var(--ink, #262626)">3,080–4,560 K</text><path d="M40 240H560M40 240V250M213.3 240V250M386.7 240V250M560 240V250" fill="none" stroke="var(--ink, #262626)" stroke-width="2"/><text x="40" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">0.1</text><text x="213.3" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">1</text><text x="386.7" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">10</text><text x="560" y="276" font-size="20" text-anchor="middle" fill="var(--ink, #262626)">100</text><text x="126.7" y="314" font-size="20" text-anchor="middle" fill="var(--ink-weak, #6E6E6E)">← prefers magma</text><text x="386.7" y="314" font-size="20" text-anchor="middle" fill="var(--ink-weak, #6E6E6E)">prefers metal (core) →</text><text x="300" y="356" font-size="20" font-weight="700" text-anchor="middle" fill="var(--ink, #262626)">Partition coefficient D<tspan dy="5" font-size="18">H</tspan><tspan dy="-5"> (log scale)</tspan></text></svg>

- D<sub>H</sub> is 29–57 at 300,000–600,000 atm and 3,080–4,560 K
- Consistent with first-principles calculations
- Low reported values likely come from measuring after decompression

<div class="attr">Redrawn after Tagawa (2022), Fig. 7 (p.29); schematic, values from the text</div>

<div class="takeaway">First experiments to span core-formation conditions</div>

---

<!-- _class: lay-lead -->

## Core hydrogen: 30–70 times that in today’s oceans

Uptake of hydrogen into the core may be the main mechanism that “regulated” the amount of ocean water.

---

<!-- _class: lay-steps -->

## What comes next

1. **Narrow down the origin of water**
   Combine with sample returns from C-type asteroids (Hayabusa2, OSIRIS-REx).
2. **Study light elements other than hydrogen**
   Hydrogen alone cannot explain the density deficit.
3. **Determine Earth’s bulk composition**
   Only when the core’s composition is known can Earth’s origin be understood.

---

<!-- _class: refs -->

## References

- Source: Tagawa S. “Chikyū chūshinkaku no suiso” [Hydrogen in the Earth’s core]. Isotope News 2022;(780):26–30 [in Japanese].
- References of the source, as printed on its p.30:
- 1) Tagawa, et al., Nat. Commun., 12, 2588 (2021)
- 2) Fischer, et al., GCA, 167, 177-194 (2015)
- 3) Siebert, et al., Science, 339, 1194-1197 (2013)
- 4) Rubie, et al., Icarus, 248, 89-108 (2015)
- 5) Hirose, et al., Nat. Rev. Earth Environ, 2, 645-658 (2021)
- 6) Okuchi, Science, 278, 1781-1784 (1997)
- 7) Clesi, et al., Sci. Adv., 4, e1701876 (2018)
- 8) Malavergne, et al., Icarus, 321, 473-485 (2019)
- 9) Hirao, et al., MRE, 5, 018403 (2020)
- 10) 圦本，顕微鏡，41, 134-137 (2006)
- 11) 坂本，J. Mass Spectrom. Soc. Jpn., 69, 176-181 (2021)
- 12) Li, et al., Nat. Geosci., 13, 453-458 (2020)
- 13) Iizuka-Oku, et al., Nat. Commun., 8, 14096 (2017)
