# Security Policy

Toretto inspects and transforms live HTML documents. Treat page contents, URLs, form values, authentication state, and browser metadata as sensitive.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/trytoretto/toretto/security/advisories/new).

Include the affected version and browser, security impact, and minimal reproduction using synthetic data. Never submit real credentials, session tokens, private page contents, or another person's data.

## Security boundaries

Relevant reports include script execution through imported HTML, access beyond extension permissions, page-data leakage, unsafe URL fetching, CSP bypasses, prototype pollution, and sensitive information appearing in logs or exported scenes.

Good-faith research is welcome when it uses systems and data the researcher owns or is authorized to test, avoids privacy violations and disruption, stops after demonstrating the minimum access necessary, and allows reasonable time for remediation.
