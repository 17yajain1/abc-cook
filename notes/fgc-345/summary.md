## A/B table (one row per call)

| call | tier | repair-would-fire | first ingr s | steps done s | done s | max silence s | max gap s | out tok | reasoning | INR | added | must-choose (added/role!=req/dop=false/serv stated) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chole-bhature.B1 | degraded | True | 3.891 | 43.375 | 45.984 | 3.125 | 0.188 | 4779 | 192 | 0.9426372500000001 | 0 | 0/0/5/0 |
| croissant.A1 | clean | False | 11.203 | 35.547 | 37.297 | 10.562 | 0.109 | 3829 | 896 | 0.7028650000000001 | 0 | 0/0/0/0 |
| croissant.A2 | clean | False | 7.766 | 32.203 | 33.094 | 6.922 | 0.172 | 3312 | 640 | 0.588047 | 0 | 0/0/0/0 |
| croissant.A3 | clean | False | 16.438 | 39.141 | 40.031 | 15.469 | 0.141 | 3550 | 1152 | 0.628507 | 0 | 0/0/1/0 |
| croissant.B1 | clean | False | 10.188 | 31.11 | 31.829 | 9.594 | 0.141 | 3405 | 960 | 0.626756 | 0 | 0/0/2/0 |
| croissant.B2 | clean | False | 8.296 | 31.718 | 32.671 | 7.641 | 0.11 | 3994 | 832 | 0.7048540000000001 | 0 | 0/0/0/0 |
| croissant.B3 | clean | False | 8.125 | 28.078 | 29.156 | 7.562 | 0.156 | 3415 | 896 | 0.606424 | 0 | 0/0/0/0 |
| kadhi-pakora.A1 | clean | False | 11.078 | 33.703 | 34.813 | 10.531 | 0.109 | 4371 | 1408 | 0.8362300000000001 | 0 | 0/0/1/1 |
| kadhi-pakora.A2 | clean | False | 11.0 | 28.407 | 29.438 | 10.016 | 0.11 | 3223 | 960 | 0.577422 | 0 | 0/0/2/1 |
| kadhi-pakora.A3 | clean | False | 10.157 | 30.297 | 31.25 | 9.407 | 0.266 | 3474 | 768 | 0.6200920000000001 | 0 | 0/0/2/1 |
| kadhi-pakora.B1 | clean | False | 7.219 | 27.86 | 28.766 | 6.391 | 0.125 | 3063 | 512 | 0.6098410000000001 | 0 | 0/0/1/1 |
| kadhi-pakora.B2 | degraded | True | 7.015 | 31.921 | 33.296 | 6.421 | 0.171 | 3790 | 704 | 0.6746790000000001 | 0 | 0/0/2/1 |
| kadhi-pakora.B3 | degraded | True | 7.219 | 35.891 | 37.954 | 6.516 | 0.125 | 3951 | 704 | 0.7020490000000001 | 0 | 0/0/2/1 |
| partial-ingredients-only.A1 | tier0 | False | 5.594 | None | 13.828 | 5.125 | 0.094 | 1747 | 512 | 0.34371875 | 0 | None/None/None/None |
| partial-ingredients-only.B1 | tier0 | False | 10.0 | None | 22.625 | 9.11 | 0.219 | 2107 | 832 | 0.40088975000000004 | 0 | None/None/None/None |
| partial-ingredients-only.B2 | tier0 | False | 6.531 | None | 16.14 | 5.875 | 0.079 | 1695 | 448 | 0.31371375 | 0 | None/None/None/None |
| pumpkin-pancakes.A1 | degraded | True | 7.594 | 19.828 | 20.672 | 7.0 | 0.281 | 2421 | 640 | 0.46548125 | 0 | 0/2/1/0 |
| pumpkin-pancakes.A2 | degraded | True | 11.313 | 25.547 | 26.407 | 10.5 | 0.141 | 2357 | 832 | 0.42522525000000005 | 0 | 0/2/1/0 |
| pumpkin-pancakes.A3 | clean | False | 3.922 | 15.61 | 16.328 | 3.407 | 0.094 | 1929 | 320 | 0.35246525000000006 | 0 | 0/2/1/0 |
| pumpkin-pancakes.B1 | degraded | True | 8.391 | 18.266 | 18.891 | 7.906 | 0.093 | 2402 | 960 | 0.45822225000000005 | 0 | 0/2/3/0 |
| pumpkin-pancakes.B2 | degraded | True | 7.485 | 18.11 | 18.86 | 6.891 | 0.11 | 2290 | 640 | 0.41470225000000005 | 0 | 0/2/1/0 |
| pumpkin-pancakes.B3 | degraded | True | 6.735 | 18.704 | 19.235 | 6.11 | 0.094 | 1935 | 512 | 0.35435225000000004 | 0 | 0/2/1/0 |
| vanilla-cupcakes.A1 | degraded | True | 9.125 | 15.203 | 15.875 | 8.453 | 0.187 | 1602 | 640 | 0.49939625000000004 | 0 | 0/2/0/0 |
| vanilla-cupcakes.A2 | degraded | True | 13.062 | 22.75 | 23.75 | 12.109 | 0.14 | 1793 | 832 | 0.32868225 | 0 | 0/2/0/0 |
| vanilla-cupcakes.A3 | degraded | True | 16.859 | 25.968 | 26.859 | 15.796 | 0.64 | 2206 | 1280 | 0.39889225 | 0 | 0/2/0/0 |
| vanilla-cupcakes.B1 | degraded | True | 7.687 | 11.468 | 12.437 | 7.156 | 0.328 | 1540 | 832 | 0.50441125 | 0 | 0/0/0/0 |
| vanilla-cupcakes.B2 | degraded | True | 11.125 | 18.265 | 19.234 | 10.39 | 0.094 | 2002 | 960 | 0.36752724999999997 | 0 | 0/2/0/0 |
| vanilla-cupcakes.B3 | degraded | True | 14.484 | 22.093 | 23.031 | 13.781 | 0.125 | 2355 | 1344 | 0.42753725000000004 | 0 | 0/2/0/0 |

## Per recipe/arm medians

| recipe | arm | n | first ingr median | steps done median | done median | tiers |
|---|---|---|---|---|---|---|
| chole-bhature | B | 1 | 3.891 | 43.375 | 46.0 | ['degraded'] |
| croissant | A | 3 | 11.203 | 35.547 | 37.3 | ['clean', 'clean', 'clean'] |
| croissant | B | 3 | 8.296 | 31.11 | 31.8 | ['clean', 'clean', 'clean'] |
| kadhi-pakora | A | 3 | 11.0 | 30.297 | 31.2 | ['clean', 'clean', 'clean'] |
| kadhi-pakora | B | 3 | 7.219 | 31.921 | 33.3 | ['clean', 'degraded', 'degraded'] |
| partial-ingredients-only | A | 1 | 5.594 | None | 13.8 | ['tier0'] |
| partial-ingredients-only | B | 2 | 8.2655 | None | 19.4 | ['tier0', 'tier0'] |
| pumpkin-pancakes | A | 3 | 7.594 | 19.828 | 20.7 | ['degraded', 'degraded', 'clean'] |
| pumpkin-pancakes | B | 3 | 7.485 | 18.266 | 18.9 | ['degraded', 'degraded', 'degraded'] |
| vanilla-cupcakes | A | 3 | 13.062 | 22.75 | 23.8 | ['degraded', 'degraded', 'degraded'] |
| vanilla-cupcakes | B | 3 | 11.125 | 18.265 | 19.2 | ['degraded', 'degraded', 'degraded'] |

## Must-choose counts per arm (sum over calls)

- arm A: {'origin_added': 0, 'role_not_required': 12, 'depends_on_previous_false': 9, 'servings_source_stated': 3}
- arm B: {'origin_added': 0, 'role_not_required': 10, 'depends_on_previous_false': 17, 'servings_source_stated': 3}

## Every added step (model output), by recipe

### chole-bhature
- chole-bhature.B1: none
### croissant
- croissant.B1: none
- croissant.B2: none
- croissant.B3: none
### kadhi-pakora
- kadhi-pakora.B1: none
- kadhi-pakora.B2: none
- kadhi-pakora.B3: none
### partial-ingredients-only
- partial-ingredients-only.B1: none
- partial-ingredients-only.B2: none
### pumpkin-pancakes
- pumpkin-pancakes.B1: none
- pumpkin-pancakes.B2: none
- pumpkin-pancakes.B3: none
### vanilla-cupcakes
- vanilla-cupcakes.B1: none
- vanilla-cupcakes.B2: none
- vanilla-cupcakes.B3: none

## Guard drops (warnings 'Dropped the step ABC Cook would have added'), by call


Totals per arm: {}

## Added steps that reached the plan


## Rule 2 / gap metric (cupcakes)

- vanilla-cupcakes.A1: rule2 pass=n/a; gap metric fires on=False; total_min=34.0; nodes=['Preheat oven', 'Bake cupcakes', 'Powder sugar (optional)']
- vanilla-cupcakes.A2: rule2 pass=n/a; gap metric fires on=False; total_min=34.0; nodes=['Preheat oven', 'Bake cupcakes', 'Powder sugar']
- vanilla-cupcakes.A3: rule2 pass=n/a; gap metric fires on=False; total_min=48.0; nodes=['Powder sugar', 'Butter substitute', 'Preheat oven', 'Bake cupcakes']
- vanilla-cupcakes.B1: rule2 pass=False; gap metric fires on=False; total_min=32.0; nodes=['Preheat oven', 'Bake cupcakes']
- vanilla-cupcakes.B2: rule2 pass=False; gap metric fires on=False; total_min=34.0; nodes=['Preheat oven', 'Bake cupcakes', 'Powder sugar']
- vanilla-cupcakes.B3: rule2 pass=False; gap metric fires on=False; total_min=34.0; nodes=['Preheat oven', 'Bake cupcakes', 'Powder sugar']

## Stated (extracted) durations per recipe/arm, as sorted (min,typ,max) multisets

- chole-bhature.B1: [(1, 1, 1), (5, 5, 8), (7, 7, 9), (10, 10, 18), (10, 10, 25), (10, 12, 15), (360, 360, 360)]
- croissant.A1: [(5, 8, 10), (6, 6, 7), (20, 22, 25), (60, 60, 66), (60, 60, 66), (60, 60, 66)]
- croissant.A2: [(5, 5, 10), (6, 6, 6), (20, 22, 25), (60, 60, 60), (60, 60, 60), (60, 60, 60)]
- croissant.A3: [(5, 8, 10), (6, 6, 8), (20, 22, 25), (60, 60, 65), (60, 60, 65), (60, 60, 65)]
- croissant.B1: [(5, 8, 10), (6, 6, 6), (20, 22, 25), (60, 60, 66), (60, 60, 66), (60, 60, 66)]
- croissant.B2: [(5, 5, 10), (6, 6, 6), (20, 22, 25), (60, 60, 70), (60, 60, 70), (60, 60, 70)]
- croissant.B3: [(5, 5, 10), (6, 6, 7), (20, 22, 25), (60, 60, 66), (60, 60, 66), (60, 60, 66)]
- kadhi-pakora.A1: [(10, 10, 10)]
- kadhi-pakora.A2: [(10, 10, 10)]
- kadhi-pakora.A3: [(10, 10, 10)]
- kadhi-pakora.B1: [(10, 10, 10)]
- kadhi-pakora.B2: []
- kadhi-pakora.B3: []
- pumpkin-pancakes.A1: []
- pumpkin-pancakes.A2: []
- pumpkin-pancakes.A3: []
- pumpkin-pancakes.B1: []
- pumpkin-pancakes.B2: []
- pumpkin-pancakes.B3: []
- vanilla-cupcakes.A1: [(10, 10, 12), (20, 22, 25)]
- vanilla-cupcakes.A2: [(10, 10, 12), (20, 22, 25)]
- vanilla-cupcakes.A3: [(10, 10, 11), (20, 22, 25)]
- vanilla-cupcakes.B1: [(10, 10, 12), (20, 22, 25)]
- vanilla-cupcakes.B2: [(10, 10, 11), (20, 22, 25)]
- vanilla-cupcakes.B3: [(10, 10, 11), (20, 22, 25)]

## Edge agreement (source nodes, S3 matcher; mean of recall/precision)

- chole-bhature: within-A None (pairs 0), cross A x B None (pairs 0)
- croissant: within-A 0.848 (pairs 3), cross A x B 0.715 (pairs 9)
- kadhi-pakora: within-A 0.445 (pairs 3), cross A x B 0.446 (pairs 9)
- partial-ingredients-only: within-A None (pairs 0), cross A x B None (pairs 0)
- pumpkin-pancakes: within-A 0.667 (pairs 3), cross A x B 0.57 (pairs 9)
- vanilla-cupcakes: within-A 0.833 (pairs 3), cross A x B 0.944 (pairs 9)

## Pumpkin: serving ways and 'Serve with chips'

### pumpkin-pancakes.A1 (tier degraded)
- step 6: role=optional attach=5 cue='There is two different ways to eat these pancakes.' text='There are two different ways to eat these pancakes: the classic with butter and maple syrup.'
- step 7: role=optional attach=5 cue='But, then you have to try it my favorite way to eat it, which is with chocolate chips.' text="Alternatively, top with chocolate chips (or chocolate syrup) and homemade Cool Whip as the creator's favorite way to eat them."
- plan nodes: ['Mix pumpkin', 'Add spices', 'Add leavener', 'Add dry & milk', 'Mix batter', 'Cook pancakes', 'Serve with chocolate']
- tips: ['Optional: There are two different ways to eat these pancakes: the classic with butter and maple syrup.']
- 'chips' required node(s): [('Serve with chocolate', ['step_put_butter_on_a_hot_pan'])]; total_min=24.0
- warnings on roles: ['Step "Alternatively, top with chocolate chips (or chocolate syrup)..." was marked optional, but its cue "But, then you have to try it my favorite way to eat it, which is with chocolate chips." is not a grounded optional/alternative phrase; kept as a required step.', 'Kept "There are two different ways to eat these pancakes: the classic with butter and maple syrup." as an optional note on "Cook pancakes".']
### pumpkin-pancakes.A2 (tier degraded)
- step 4: role=required attach=None cue=None text='Heat a pan, put some butter on the pan, and cook the pancakes like you would any other pancake.'
- step 5: role=optional attach=4 cue='There is two different ways to eat these pancakes.' text='There are two different ways to eat these pancakes: classic with butter and maple syrup.'
- step 6: role=optional attach=4 cue='There is two different ways to eat these pancakes.' text="Or top with chocolate chips (or chocolate syrup) and homemade Cool Whip, the creator's favorite."
- plan nodes: ['Mix pumpkin', 'Season batter', 'Add leavening', 'Combine dry and wet', 'Cook pancakes', 'Serve with chocolate']
- tips: ['Optional: There are two different ways to eat these pancakes: classic with butter and maple syrup.']
- 'chips' required node(s): [('Serve with chocolate', ['step_heat_a_pan_put_some_butter'])]; total_min=20.0
- warnings on roles: ['Step "Or top with chocolate chips (or chocolate syrup) and homemad..." was marked optional, but its cue "There is two different ways to eat these pancakes." is borrowed from elsewhere in the recipe and does not chain to that instruction via attach_to_step; kept as a required step.', 'Kept "There are two different ways to eat these pancakes: classic with butter and maple syrup." as an optional note on "Cook pancakes".']
### pumpkin-pancakes.A3 (tier clean)
- step 3: role=required attach=None cue=None text='Heat a pan and put some butter on the pan, then cook pancakes as you would any other pancake (pour batter, flip when set, cook through).'
- step 4: role=required attach=None cue=None text='Serve the pancakes; the video describes two different ways to eat them (classic or with chocolate).'
- step 5: role=optional attach=4 cue='The first one being' text='The first one being like the classic with butter on top and maple syrup.'
- step 6: role=optional attach=4 cue='But, then you have to try it my favorite way to eat it' text='But, then you have to try it my favorite way to eat it, which is with chocolate chips and some homemade Cool Whip on top (or chocolate syrup).'
- plan nodes: ['Mix pumpkin', 'Season batter', 'Finish batter', 'Cook pancakes', 'Serve', 'Classic topping', 'Chocolate topping']
- tips: []
- 'chips' required node(s): [('Chocolate topping', ['step_serve_the_pancakes_the_video_describes', 'step_heat_a_pan_and_put_some', 'step_the_first_one_being_like_the'])]; total_min=35.0
- warnings on roles: ['Step "The first one being like the classic with butter on top and ..." was marked optional, but its cue "The first one being" is not a grounded optional/alternative phrase; kept as a required step.', 'Step "But, then you have to try it my favorite way to eat it, whic..." was marked optional, but its cue "But, then you have to try it my favorite way to eat it" is not a grounded optional/alternative phrase; kept as a required step.']
### pumpkin-pancakes.B1 (tier degraded)
- step 3: role=required attach=None cue=None text='Put butter on a heated pan and make pancakes like you would any other pancake, cooking until set and flipping to finish each pancake.'
- step 4: role=optional attach=3 cue='The first one being like the classic' text='The first one being like the classic with butter on top, our homemade butter on top. And maple syrup, of course.'
- step 5: role=optional attach=3 cue='But, then you have to try it my favorite way to eat it' text='But, then you have to try it my favorite way to eat it, which is with chocolate chips (or chocolate syrup) and some homemade Cool Whip on top.'
- plan nodes: ['Combine pumpkin', 'Add spices and sugar', 'Make batter', 'Cook pancakes', 'Classic serving', 'Chocolate serving']
- tips: []
- 'chips' required node(s): [('Chocolate serving', ['step_the_first_one_being_like_the'])]; total_min=26.0
- warnings on roles: ['Step "The first one being like the classic with butter on top, our..." was marked optional, but its cue "The first one being like the classic" is not a grounded optional/alternative phrase; kept as a required step.', 'Step "But, then you have to try it my favorite way to eat it, whic..." was marked optional, but its cue "But, then you have to try it my favorite way to eat it" is not a grounded optional/alternative phrase; kept as a required step.']
### pumpkin-pancakes.B2 (tier degraded)
- step 3: role=required attach=None cue=None text='Put some butter on a heated pan (grease the pan) before cooking.'
- step 5: role=optional attach=4 cue='There is two different ways to eat these pancakes.' text='There are two different ways to eat these pancakes: the classic with butter and maple syrup (serve with butter and maple syrup).'
- step 6: role=optional attach=4 cue='There is two different ways to eat these pancakes.' text="Or eat them with chocolate chips (or chocolate syrup) and homemade Cool Whip on top — the creator's favorite way."
- plan nodes: ['Mix pumpkin', 'Add spices', 'Make batter', 'Heat and grease', 'Cook pancakes', 'Serve chocolate']
- tips: ['Optional: There are two different ways to eat these pancakes: the classic with butter and maple syrup (serve with butter and maple syrup).']
- 'chips' required node(s): [('Serve chocolate', ['step_cook_pancakes_on_the_pan_like'])]; total_min=14.0
- warnings on roles: ['Step "Or eat them with chocolate chips (or chocolate syrup) and ho..." was marked optional, but its cue "There is two different ways to eat these pancakes." is borrowed from elsewhere in the recipe and does not chain to that instruction via attach_to_step; kept as a required step.', 'Kept "There are two different ways to eat these pancakes: the classic with butter and maple syrup (serve with butter and maple syrup)." as an optional note on "Cook pancakes".']
### pumpkin-pancakes.B3 (tier degraded)
- step 4: role=optional attach=3 cue='There is two different ways to eat these pancakes.' text='There is two different ways to eat these pancakes. Classic: butter on top and maple syrup.'
- step 5: role=optional attach=3 cue='There is two different ways to eat these pancakes.' text='Alternative serving: sprinkle chocolate chips (or use chocolate syrup) and top with homemade Cool Whip.'
- plan nodes: ['Mix pumpkin', 'Add spices', 'Combine batter', 'Cook pancakes', 'Chocolate serving']
- tips: ['Optional: There is two different ways to eat these pancakes. Classic: butter on top and maple syrup.']
- 'chips' required node(s): [('Chocolate serving', ['step_put_butter_on_a_pan_and'])]; total_min=15.0
- warnings on roles: ['Step "Alternative serving: sprinkle chocolate chips (or use chocol..." was marked optional, but its cue "There is two different ways to eat these pancakes." is borrowed from elsewhere in the recipe and does not chain to that instruction via attach_to_step; kept as a required step.', 'Kept "There is two different ways to eat these pancakes. Classic: butter on top and maple syrup." as an optional note on "Cook pancakes".']

## Chole (B1)

- tier=degraded added=[] silence=3.125 gap=0.188 marks={'first_ingredient_s': 3.891, 'ingredients_complete_s': 12.766, 'first_step_s': 13.344, 'steps_complete_s': 43.375}

## partial-ingredients-only

- partial-ingredients-only.A1: status=method_not_grounded tier=tier0 steps_in_output=None added=0
- partial-ingredients-only.B1: status=method_not_grounded tier=tier0 steps_in_output=None added=0
- partial-ingredients-only.B2: status=method_not_grounded tier=tier0 steps_in_output=None added=0

## Violations pre-repair (repair-would-fire)

- chole-bhature.B1: ['produces_consumed', 'produces_consumed', 'produces_consumed']
- kadhi-pakora.B2: ['produces_consumed']
- kadhi-pakora.B3: ['produces_consumed']
- pumpkin-pancakes.A1: ['ingredients_consumed']
- pumpkin-pancakes.A2: ['ingredients_consumed']
- pumpkin-pancakes.B1: ['ingredients_consumed']
- pumpkin-pancakes.B2: ['ingredients_consumed']
- pumpkin-pancakes.B3: ['ingredients_consumed']
- vanilla-cupcakes.A1: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']
- vanilla-cupcakes.A2: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']
- vanilla-cupcakes.A3: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']
- vanilla-cupcakes.B1: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']
- vanilla-cupcakes.B2: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']
- vanilla-cupcakes.B3: ['ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed', 'ingredients_consumed']