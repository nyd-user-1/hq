# @nysgpt/ui-layer

**Not yet extracted.** This directory reserves the name and the shape; the code
still lives in `~/Code/44b/src/components/DevInspector.tsx`, where it is being
actively written.

## What it is

A dev-only React inspector. Hold ⌥ and the running app X-rays itself: every
element tints by which architectural layer it belongs to, so a page's structure
becomes visible without opening a file. ⌥-click jumps to the source. ⇧⌥-click
adds an element to an extraction set — the list you hand to an agent when you
want a component pulled out of a page and made real.

It is hand-rolled because React 19 removed `fiber._debugSource`, which is what
`react-dev-inspector` and its relatives were built on. Source location is
recovered another way.

## Why it isn't here yet

Extracting it means deciding three things that its host app currently answers
implicitly:

- **Source location.** It needs a `/api/dev-locate` endpoint. As a package it
  has to either ship that route, ship a bundler plugin that bakes locations in,
  or accept a resolver from the host.
- **Layer definitions.** The layer colours are 44b's architecture. A package
  needs them supplied as config, not assumed.
- **Dev-only enforcement.** Today a `next.config` alias swaps in
  `DevInspector.stub.tsx` for production builds. A package has to make that
  trivial and hard to get wrong — shipping an inspector to production is the one
  unacceptable failure.

Extract when the 44b implementation stops moving.
