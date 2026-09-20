# Third-party notices

This repository, and the game built from it, redistribute material from the
works below. Each entry reproduces the notice that work's licence requires be
retained, not a summary of it. Where a notice already ships beside the asset it
covers, the entry points there rather than duplicating the text.

Which upstream source feeds which build stage, and the licence status of the
sources whose material is *not* redistributed, is recorded in
[docs/data.md](./docs/data.md).

## CMUdict (Carnegie Mellon Pronouncing Dictionary)

Used for pronunciations and stress markers. The bulk dictionary is pinned
rather than committed, but ARPAbet material plausibly derived from it is
committed in `data/supplement.dict` and `data/deferred-readings.jsonl`, and
pronunciations derived from it are compiled into the Rhyme Index served to
players. The licence is BSD-2-Clause and requires the notice below be retained
on redistribution in either form.

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in
the documentation and/or other materials provided with the
distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Cinzel (font)

Bundled in the shared-badge renderer as `web/badge/font/Cinzel-Variable.ttf`
and served with the badge image. Licensed under the SIL Open Font License 1.1,
whose text ships beside the font at
[`web/badge/font/OFL.txt`](./web/badge/font/OFL.txt) and is not duplicated here.
