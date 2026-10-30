#!/usr/bin/env python
# coding: utf-8

# In[1]:


machine_rates = {
    "Flexo A": 112,
    "Flexo B": 224,
    "Flexo C": 175,
}

orders_data = [
    {"id": 1, "quantity": 16539, "inks": [6, 8]},
    {"id": 2, "quantity": 5020, "inks": [4, 5, 6]},
    {"id": 3, "quantity": 5110, "inks": [1, 2, 8]},
    {"id": 4, "quantity": 6030, "inks": [6, 6]},
    {"id": 5, "quantity": 6100, "inks": [9]},
    {"id": 6, "quantity": 24173, "inks": [6, 8, 9]},
    {"id": 7, "quantity": 15740, "inks": [2, 4, 6, 6]},
    {"id": 8, "quantity": 21165, "inks": [6, 4, 6]},
    {"id": 9, "quantity": 4640, "inks": [8]},
    {"id": 10, "quantity": 12100, "inks": [5, 8, 9]},
    {"id": 11, "quantity": 8000, "inks": [8, 9]},
    {"id": 12, "quantity": 14030, "inks": [6, 5, 6, 8]},
    {"id": 13, "quantity": 5180, "inks": [4, 8]},
    {"id": 14, "quantity": 9150, "inks": [9]},
    {"id": 15, "quantity": 23979, "inks": [7, 4, 6]},
]

# Define the fixed schedule
fixed_schedule = {
    "Flexo A": [4, 3, 5, 1, 2],
    "Flexo B": [9, 7, 8, 6, 10],
    "Flexo C": [11, 15, 14, 12, 13],
}

job_batches = [
    {"arrival_time": 0.0, "orders": list(range(1, 16))}  # All orders arrive at once
]

SEEDS = list(range(42, 72))

SA_OPT_PARAMS = {
    "sequence_dependent_setup_time": 0.75,
    "batch_flow_time_weight": 0.6,
    "ink_weight": 0.4,
    "iterations": 833333,
    "num_starts": 6,
    "T_max": 0.1603194019,
    "T_min": 0.0116169910,
    "N_s": 4908,
    "rcl_alpha": 0.2746914740,
    "move_probs": (0.6647498733, 0.5008078735, 0.2693767726),
}


# In[2]:


import signature
import pandas as pd
import json
import matplotlib.pyplot as plt
from IPython.display import display

# 1. Prepare configuration
cfg = signature.ExperimentConfig(
    machine_production_rates=machine_rates,
    orders_data=orders_data,
    job_batches=job_batches,
    **SA_OPT_PARAMS,
    show_summary=False,
    show_timeline_chart=False,
    show_timeline_table=False
)

# 2. Run GRASP-SA 30 times
df, stats = signature.run_experiments_multiple_seeds(
    cfg, 
    SEEDS, 
    verbose=True,
    show_unique_timelines=False
)

# 3. Get best schedule from GRASP-SA
best_run = df.loc[df['Fitness'].idxmin()]
best_fitness_grasp = best_run['Fitness']
best_bft_grasp = best_run['Batch Flow Time (h)']
best_ink_grasp = best_run['Ink Changes']

print(f"Best GRASP-SA Fitness: {best_fitness_grasp:.3f}")
print(f"Best GRASP-SA BFT: {best_bft_grasp:.2f} h")
print(f"Best GRASP-SA Ink Changes: {best_ink_grasp}")

best_schedule_raw = json.loads(best_run['Schedule JSON'])

class JobObj:
    def __init__(self, order_code, arrival_time, qty, inks):
        self.order_code = order_code
        self.arrival_time = arrival_time
        self.production_quantity = qty
        self.inks = tuple(inks)

orders_dict = {str(o["id"]): o for o in orders_data}
arrival_times = {str(o): b["arrival_time"] for b in job_batches for o in b["orders"]}

best_schedule = {}
for m, jobs in best_schedule_raw.items():
    best_schedule[m] = [
        JobObj(str(j_id), arrival_times[str(j_id)], orders_dict[str(j_id)]["quantity"], orders_dict[str(j_id)]["inks"])
        for j_id in jobs
    ]

# Build Gantt Chart for Best GRASP-SA
best_tl_data, best_color_map, best_job_arrivals = signature.build_timeline_data(best_schedule, job_batches, cfg)
fig_best = signature.create_timeline_chart(best_tl_data, best_job_arrivals, cfg)
fig_best.suptitle("Best GRASP-SA Schedule", fontsize=20, y=1.05)
plt.show()

# 4. Evaluate Fixed Schedule
fixed_schedule_obj = {}
for m, jobs in fixed_schedule.items():
    fixed_schedule_obj[m] = [
        JobObj(str(j_id), arrival_times[str(j_id)], orders_dict[str(j_id)]["quantity"], orders_dict[str(j_id)]["inks"])
        for j_id in jobs
    ]

fix_tl_data, fix_color_map, fix_job_arrivals = signature.build_timeline_data(fixed_schedule_obj, job_batches, cfg)

fix_df = pd.DataFrame(fix_tl_data)
bft_total = 0
unique_batches = list(set([b["arrival_time"] for b in job_batches]))
for batch_time in unique_batches:
    batch_orders = [str(o) for b in job_batches if b["arrival_time"] == batch_time for o in b["orders"]]
    batch_jobs = fix_df[fix_df["order_code"].astype(str).isin(batch_orders)]
    if not batch_jobs.empty:
        c_max = batch_jobs["end_hours"].max()
        bft_total += (c_max - batch_time)

bft_h_fix = bft_total / len(unique_batches) if unique_batches else 0
ink_fix = fix_df["num_changes"].sum()
fitness_fix = SA_OPT_PARAMS["ink_weight"] * ink_fix + SA_OPT_PARAMS["batch_flow_time_weight"] * bft_h_fix

print(f"\nFixed Schedule Fitness: {fitness_fix:.3f}")
print(f"Fixed Schedule BFT: {bft_h_fix:.2f} h")
print(f"Fixed Schedule Ink Changes: {ink_fix}")

fig_fix = signature.create_timeline_chart(fix_tl_data, fix_job_arrivals, cfg)
fig_fix.suptitle("Fixed Schedule", fontsize=20, y=1.05)
plt.show()

# 5. Simple Comparison
comp_df = pd.DataFrame({
    "Metric": ["Fitness", "Batch Flow Time (h)", "Ink Changes"],
    "Fixed Schedule": [fitness_fix, bft_h_fix, ink_fix],
    "Best GRASP-SA": [best_fitness_grasp, best_bft_grasp, best_ink_grasp]
})
print("\nComparison:")
display(comp_df)

