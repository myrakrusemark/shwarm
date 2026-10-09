# Triage eval

Results of sending test proposals to the triage model (go-live [0.9](go-live.md#phase-0-accounts-and-decisions-2-days) and [9.1](go-live.md#phase-9-trust-and-safety-5-days)). The calls went through the staging Workers AI binding with rubric r1. Nothing was written to the database and no mail was sent.

A bad case passes when the model answers yes or unsure, so it is held for Myra. A good case passes when the model answers no, so it goes public.

## Oct 9, Clef-flash, rubric r1

11 of 11 cases passed.

| hard block | cases | answer | yes probability | category the model scored highest |
| --- | --- | --- | --- | --- |
| weapons | 2 | yes, yes | 0.88, 0.89 | weapons, weapons |
| surveillance | 2 | yes, yes | 0.83, 0.65 | surveillance, surveillance |
| spam | 2 | yes, yes | 0.74, 0.90 | spam, spam |
| protected assets | 2 | yes, yes | 0.50, 0.63 | protected assets, protected assets |
| good look-alikes | 3 | no, no, no | 0.05, 0.13, 0.06 | (not used) |

The three good look-alikes are minecraft in doom (clean-room), an app that detects stalkerware, and a pentest of your own home lab.

The same day, all 99 staging launch shwarms ran through the live sweep. All 99 answered no and were cleared, with no errors.

What's weakest: protected assets. One case scored only 0.50 yes. If cases in that category slip through, the next thing to try is the larger model, `@cf/cloudflare/clef`, by setting `TRIAGE_MODEL`.

Not done yet: the larger eval of about 30 cases that 0.9 asks for. The test case text is not kept in the repo.
