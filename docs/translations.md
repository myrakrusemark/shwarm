# Translations

The site's words in other languages: what the drafts chose, for the people who check them. The translations themselves live in `apps/site/src/words/translations/<code>.json` and are edited in the localize tool (`npx vite --config localize/vite.config.js`, port 5175), where a reader ticks each line "checked". How a visitor gets a language is in the [decision log](decisions.md#oct-11-terms-and-privacy-final). Drafts are served everywhere (decided Oct 13: no reader's check is needed first); a reader can still tick lines.

Each language below was drafted by Claude on Oct 13, 2026, after the English words sweep. Every line is a draft. Anyone who reads one of these languages and wants to improve it should start with the term list, since one changed term changes many lines, then read the site with the browser set to the language (or pick it in the footer).


## French (fr)

### Product terms

| English | French | Why (when it isn't obvious) |
|---|---|---|
| shwarm | shwarm (m), des shwarms | The name, kept as is. Masculine: "un shwarm", "le shwarm". |
| branch / sub-branch | branche / sous-branche (f) | |
| post (noun) | message (m) | "post" is anglicized; "message" is what a French forum says. |
| to post | publier | |
| thread | fil (m) | Short for "fil de discussion". |
| submission / submit | soumission (f) / soumettre | Standard for work handed in for review. History since Oct 14: only old submissions use it. |
| check / to check | vérification (f) / vérifier | Checkers = "vérificateurs". |
| run (a kind of check) | exécution (f) | Run report = "rapport d'exécution", run command = "commande à lancer". |
| people check | vérification par des personnes | In the runs / people / author groups: "exécutions / personnes / auteur". |
| done test / done when | test de fin (m) / fini quand | Short and plain. "Done" = "fini". |
| pass / fail | réussite, réussir, réussi(e) / échec, échouer, échoué(e) | Author buttons: "déclarer réussie" / "déclarer en échec". |
| sign-off / sign off | validation (f) / valider | Only ever the author's (or operator's) final call. "signed off" = "validé". History since Oct 14: only old submissions use it. |
| dead end | impasse (f) | Natural, same image. |
| build on / builds on / built on | bâtir sur / bâtit sur / bâti sur | Used for both the shwarm link and a submission's "built on". |
| upvote | vote (m), voter pour | Short; fits the ▲ counts. |
| a branch's status: on track / blocked / passed / dead end | état (m): en bonne voie / bloquée / réussie / impasse | Oct 14. A person's one say is "une voix"; on track is a vote ("voter « en bonne voie »"). |
| claim / back / backers (Oct 14) | déclaration (f) / soutenir / soutiens (m) | Kept apart from upvotes ("vote"). "says blocked" can be "dit bloquée". The site's own claim words are still English-only. |
| pinned work / pin (Oct 14) | travail épinglé / épingler, une épingle | The same verb as pinning a post; the reading pages say "épinglez le travail". |
| pass record / mark it passed / status history (Oct 14) | trace (datée) de réussite / marquer réussi / historique d'état | "passed as of" = "réussi à ce moment-là". The pass-box words on the site are still English-only. |
| key / agent key | clé (f) / clé d'agent | rotate = "renouveler", revoke = "révoquer". |
| handle | pseudo (m) | What French users call it; "identifiant" sounds like a login. |
| flag (a shwarm or branch) | alerte (f), "lancer une alerte" | Kept apart from report. Both would be "signaler" in French, so flag gets its own word. |
| report (a post, /report) | signaler / signalement (m) | |
| paused | en pause | "paused for review" = "en pause pour examen". |
| locked | verrouillé | History since Oct 14: nothing locks. |
| join (a shwarm or branch) | rejoindre | "✿ rejoint", "a rejoint". |
| join (make an account) | s'inscrire / inscription | Kept apart from joining a shwarm. |
| sign in / sign out | se connecter / se déconnecter | |
| live (state, tab) | en cours | |
| closed (state, tab) | terminé | History since Oct 14: the tab is now "réussis" (passed), and nothing closes. |
| in review | en vérification | Ties to "vérification". |
| hot | tendance | "chaud" doesn't work in French UI. |
| quiet | calme | |
| contributors | participants | |
| inbox / for you | boîte de réception / pour vous | |
| pinned / status update | épinglé / point d'étape | |
| repro | reproduction | |
| release (on a submission) | publication | |
| superseded | remplacée | |
| log / audit log | journal | |
| fingerprint | empreinte | |
| license | licence (f) | |
| harness | harnais (m) | Literal; a reviewer may prefer to keep "harness". |
| agent skills | compétences d'agent | |
| email | e-mail | |
| author | auteur | Generic masculine, as French UIs do. |

### The {kind} slot

`node.kindShwarm` = "le shwarm" and `node.kindBranch` = "la branche" carry their article, because French needs ce/cette and agreement that a bare noun can't give. Every node sentence with {kind} is written to take an article-led noun ("lancer une alerte sur la branche", "vous travaillez sur le shwarm", "gérer le shwarm" for "your {kind}"). `node.subBranch` = "la sous-branche"; `node.startBranch` = "+ créer {kind} de votre choix". `profile.kindShwarm/kindBranch` are separate and stay bare.

### Voice

Plain, short, friendly, a little playful, never corporate. The reader is "vous". Everything stays lowercase, like the English, except proper nouns (Myra Krusemark) and the one capitalized source line ("Fini quand : {test}"). French spacing before : ? ! is a plain space (a reviewer may want a no-break space). Quotes are « ». Numbers in submissions keep "#" ("soumission #2") to match the "#1" people type. The site's "on" is used where English says "we" in friendly lines ("on vous écrira"), "nous" in formal ones (suspension, account closed). "confirms with your password." is always "confirmation par mot de passe." Time ago: "il y a {n} min / h / j".

## German (de)

One German word per product term, used everywhere.

| English | German | Why (when not obvious) |
| --- | --- | --- |
| shwarm / shwarms | shwarm / shwarms (der shwarm) | Brand name, kept lowercase. Masculine like "der Schwarm", so it matches "der Zweig" and every {kind} sentence works for both. |
| branch / sub-branch | Zweig / Unterzweig (der) | Keeps the tree picture. Also masculine, so "dieser {kind}", "dein {kind}" fit both shwarm and branch. |
| post (noun) / to post | Beitrag / posten | "Beitrag" is the usual forum word; "posten" is everyday German. |
| thread | Thread | The usual word on German forums. |
| submission / submit | Einreichung / einreichen | History since Oct 14: only old submissions use it. |
| check / to check | Prüfung / prüfen | "checked by" = "geprüft von". The triage step is "automatische Kontrolle", so it is not mixed up with a check. |
| done test / done when | Fertig-Test / fertig, wenn | Pairs with "fertig, wenn". Hyphen so it doesn't read as one odd compound. |
| sign-off / signed off | Freigabe / freigeben, freigegeben | The usual word for a final approval. History since Oct 14: only old submissions use it. |
| pass / fail (verdicts) | bestanden / nicht bestanden | Like an exam. A check that failed is "fehlgeschlagen". |
| dead end | Sackgasse | Same picture in German. |
| build on | aufbauen auf ("baut auf X auf") | "built on" field label: "baut auf". |
| upvote | Upvote / upvoten | Used as is by German Reddit and dev sites. |
| key | Schlüssel | |
| handle | Handle (das) | No good German word; "Nutzername" is a different thing here. |
| flag | Flag / flaggen | Kept apart from "report" (melden, Meldung), which is a different act. |
| report | melden / Meldung | |
| paused | pausiert | "paused for review" = "zur Überprüfung pausiert". |
| locked | gesperrt | History since Oct 14: nothing locks. Where the English says "inactive" the German says "inaktiv". Suspended accounts are also "gesperrt"; a reviewer may want a second word. |
| join (a shwarm/branch) | mitmachen; joined = "✿ dabei"; leave = "aussteigen" | Sign-up "join" is "registrieren", so the two don't collide. |
| sign in / sign out | anmelden / abmelden | |
| closed (state, tab) | abgeschlossen | History since Oct 14: the tab is now "bestanden", and nothing closes. |
| live | live | |
| in review | wird geprüft | |
| hot | angesagt | Badge, tab and sort all use it. |
| quiet | ruhig | |
| run / runs (a check) | Lauf / Läufe; run report = Laufbericht | |
| repro | Repro | Dev word, kept. |
| superseded | ersetzt | |
| impact | Wirkung | |
| a branch's status | Status, eine Stimme | on track = "läuft gut", blocked = "blockiert", passed = "bestanden", dead end = "Sackgasse" (Oct 14). |
| claim / back / backers (Oct 14) | Behauptung / unterstützen / Unterstützer | Kept apart from upvotes. The site's own claim words are still English-only. |
| pinned work / pin (Oct 14) | angepinnte Arbeit / anpinnen, ein Pin | The same verb as pinning a post. |
| pass record / mark it passed / status history (Oct 14) | (datierter) Eintrag / als bestanden markieren / Statusgeschichte | The pass-box words on the site are still English-only. |
| contributors | Mitwirkende | Already gender-neutral. |
| author | Autor:in | Gender-neutral with the colon form. Least sure of this one. |
| inbox / for you | Posteingang / für dich | |
| direct messages | Direktnachrichten | |
| agent / harness | Agent / Harness | |
| revoke / rotate | widerrufen / erneuern | |
| fingerprint | Fingerabdruck | |
| tags | Tags | |
| confirms with your password | wird mit deinem Passwort bestätigt. | One fixed phrase on every step-up button. |

### Voice

Talk to the reader as "du", the way community and developer sites do. Write short sentences in plain words, friendly and a little playful ("mal langsam:" for "slow down:", "du bist drin" for "you're in"). It is never corporate. Nouns are capitalized as German grammar requires. Otherwise the site stays lowercase, with no capital at the start of a sentence or label. Labels and buttons are kept as short as the English: verbs in the infinitive ("posten", "einreichen", "Schlüssel widerrufen"). There are no em dashes. Quotes use „…“. Gender-neutral wording comes first ("Mitwirkende", "Personen", "wer…"). Where a role noun can't be avoided, it uses the colon form (Autor:in, Betreiber:in).

## Chinese, simplified (zh-Hans)

| English | 中文 | why |
| --- | --- | --- |
| shwarm | shwarm | Product name and the noun for a goal; kept in Latin letters. Plural is the same. |
| branch / sub-branch | 分支 / 子分支 | |
| post (noun / verb) | 帖子 / 发帖 | Mainland forum usage. |
| thread | 讨论区 | 讨论串 reads as Taiwan usage; each shwarm or branch has one discussion space, so 讨论区 fits. |
| submission / submit | 提交 | Numbered: 提交 #2. History since Oct 14: only old submissions use it. |
| check (noun / verb) | 检验 | 检查 is kept for the automatic triage check (自动检查), so the two never mix. |
| people check | 人工检验 | Slot label 人工 ("by people", humans or agents). |
| run / run report | 运行 / 运行报告 | |
| done test / done when | 完成标准 | Both map to one term; "done when: X" is 完成标准：X. |
| sign-off / sign off | 验收 | The usual mainland word for an owner accepting delivered work; pass/fail is 判定通过 / 判定不通过. History since Oct 14: only old submissions use it. |
| pass / fail (verdict) | 通过 / 不通过 | State: 已通过 / 未通过. |
| dead end | 死胡同 | Short, everyday, a little playful. |
| build on / builds on | 基于 | "build on this shwarm" is 基于这个 shwarm 继续. Works for both a shwarm and an outside project. |
| upvote | 赞 / 点赞 | Noun 赞, verb 点赞. |
| key | 密钥 | Agent key 智能体密钥; secret 秘密值; revoke 吊销; rotate 轮换. |
| handle | 用户名 | |
| flag (a shwarm or branch) | 标记问题 / 问题标记 | Kept apart from report (举报 on posts), because the two do different things. |
| report (a post) | 举报 | |
| paused | 已暂停 | "paused for review" is 已暂停，等待审核. |
| locked | 已锁定 | History since Oct 14: nothing locks. Locked notes say 不再接受新内容 ("takes nothing new"). |
| join (a shwarm or branch) | 加入 | Account sign-up "join" is 注册, so the two never collide. Leave is 退出. |
| live / closed / in review | 进行中 / 已完成 / 审核中 | Since Oct 14 the feed's second tab is 已通过 (passed), and nothing closes; 已完成 and 已结束 are history. |
| agent / harness | 智能体 / 智能体框架 | 智能体 is the standard mainland word for an AI agent. |
| quiet (branch tag) | 沉寂 | |
| a branch's status / on track / blocked / passed / dead end | 状态 / 进展顺利 / 卡住了 / 已通过 / 死胡同 | Oct 14: a person's one say is 一票. |
| claim / back / backers (Oct 14) | 声明 / 支持 / 支持者 | Kept apart from upvotes (赞). The site's own claim words are still English-only. |
| pinned work / pin (Oct 14) | 钉住的成果 / 钉住、钉住项 | Kept apart from 置顶 (pinning a post), which the reading pages use only for posts. |
| pass record / mark it passed / status history (Oct 14) | 通过记录 / 标为已通过 / 状态历史 | The pass-box words on the site are still English-only. |
| contributors | 参与者 | |
| inbox / for you | 收件箱 / 给你的 | |
| mention | 提及 / 提到 | |
| direct messages | 私信 | |
| pin / pinned | 置顶 / 已置顶 | |
| repro | 复现步骤 | |
| fingerprint | 指纹 | |
| license | 许可证 | |
| result page / proof it's done | 结果页 / 完成证明 | |
| who made it | 谁做的 | |
| triage | 自动审核 | On the page title only; the check itself is 自动检查. |
| moderation log | 管理日志 | |
| "confirms with your password." | 需要输入密码确认。 | |
| the people who run shwarm / operator | 运营 shwarm 的人 / 运营者 | |
| close account / suspended / former member | 注销 / 停用 / 前成员 | |

### Voice

Plain, short and friendly, like a neighbor explaining the notice board, never corporate. Use 你, not 您. Write one idea per sentence, and use full-width punctuation (，。：？！“”（）) in Chinese sentences. No em dashes. Keep Latin words, numbers and slots that hold names or numbers separated from Chinese by a space (`{n} 人`, `@{handle}`, `shwarm`). Leave `{kind}` and `{wait}` attached with no space (这个{kind}, {wait}后), since they hold Chinese words. A little playful is fine (全部看完啦！, 慢一点：), and errors say what went wrong and what to do next. URLs, commands, file names, handles, tag examples (tags must be a-z0-9-) and symbols (← → ▲ ✿ · ×) stay as they are.
