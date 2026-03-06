# Book landing pages (Mera Tutor demo booking)

These folders are **git subtrees** from separate GitHub repos. They are served as static files under `/book/<path>`.

When visitors use **book.meratutor.ai** (via the **meratutor-router** Vercel project), the router proxies these paths and form submissions so that **only leads from these landing pages** are sent to the CRM.

| URL path        | Source repo | Lead source in CRM |
|-----------------|-------------|----------------------|
| `/book/maths`   | [mt-lp2.0](https://github.com/krishna55238385/mt-lp2.0) | `book.meratutor.ai - maths` |
| `/book/maths-2` | mt-lp2.0 (same) | `book.meratutor.ai - maths-2` |
| `/book/science` | [mt-lp-sci](https://github.com/krishna55238385/mt-lp-sci) | `book.meratutor.ai - science` |
| `/book/science-2` | [mt-lp-sci-2](https://github.com/krishna55238385/mt-lp-sci-2) | `book.meratutor.ai - science-2` |

**Router setup (book.meratutor.ai):**  
Copy `docs/meratutor-router-vercel.json` into your **meratutor-router** repo as `vercel.json`. Add domain **book.meratutor.ai** to that project in Vercel. The rewrites send `/maths`, `/science`, etc. to this app’s `/book/...` and `/api/public/leads` to the CRM API so form submissions create leads in the CRM.

**Pull updates from a repo (e.g. mt-lp2.0):**
```bash
git subtree pull --prefix=public/book/maths https://github.com/krishna55238385/mt-lp2.0 main --squash
```
Repeat for `public/book/maths-2`, `public/book/science`, `public/book/science-2` as needed.

**Live on this app:**  
- `https://pipero-in.vercel.app/book/maths/`  
- `https://pipero-in.vercel.app/book/maths-2/`  
- `https://pipero-in.vercel.app/book/science/`  
- `https://pipero-in.vercel.app/book/science-2/`  

**Via router (book.meratutor.ai):**  
- `https://book.meratutor.ai/maths`  
- `https://book.meratutor.ai/maths-2`  
- `https://book.meratutor.ai/science`  
- `https://book.meratutor.ai/science-2`

