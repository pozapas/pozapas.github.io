/* Generated from runner/presets.json and data/recorded_runs.json. Real runs recorded 2026-10-10 (jev-1.13.0 via TypeSafe API; laya 0.4.2 default checkpoint on a laptop CPU). */
window.PRESETS = {
 "lab0_phone": {
  "label": "Crash \u00b7 distraction",
  "state": "Unit 1 northbound in light rain, left lane. Driver states she looked down at her phone for directions, looked up, and traffic had stopped. Unit 1 struck the rear of Unit 2. No injuries reported.",
  "questions": [
   {
    "id": "distracted",
    "type": "noul",
    "instructions": "Was the driver of Unit 1 distracted?"
   },
   {
    "id": "weather",
    "type": "noul",
    "instructions": "Did weather contribute to the crash?"
   }
  ]
 },
 "lab1_scaffold": {
  "label": "Construction \u00b7 scaffold",
  "state": "Worker on level 3 scaffold. East guardrail missing. Worker slipped, harness held, no injury.",
  "questions": [
   {
    "id": "fall_hazard",
    "type": "noul",
    "instructions": "Does the report describe a fall hazard?"
   },
   {
    "id": "harness_held",
    "type": "noul",
    "instructions": "Did fall protection stop the fall?"
   },
   {
    "id": "injury",
    "type": "noul",
    "instructions": "Was anyone injured?"
   }
  ]
 },
 "lab2_schema": {
  "label": "Crash \u00b7 schema",
  "state": "Unit 2 was stopped at the light on FM 1626. Driver of Unit 1 stated he felt dizzy and blacked out before the crash. Witness stated Unit 1 did not brake. Driver of Unit 1 transported to hospital by EMS.",
  "questions": [
   {
    "id": "medical_episode",
    "type": "noul",
    "instructions": "The narrative states that a driver had a medical episode, such as fainting, a seizure, or a diabetic event, before or during the crash."
   },
   {
    "id": "medical_type",
    "type": "choice",
    "instructions": "What kind of medical episode does the narrative describe?",
    "criteria": {
     "seizure": "A seizure or convulsion.",
     "loss_of_consciousness": "Fainting, blacking out, or passing out.",
     "diabetic": "Low or high blood sugar.",
     "cardiac": "Heart attack or chest pain.",
     "other": "Another medical event."
    }
   },
   {
    "id": "witness_cited",
    "type": "noul",
    "instructions": "The narrative cites a statement from a witness."
   }
  ]
 },
 "lab4_table_vs_narrative": {
  "label": "Crash \u00b7 two readers",
  "state": "Unit 1 was traveling west on Loop 410 in moderate traffic. Driver of Unit 1 stated he was reading a text message when traffic slowed ahead. Unit 1 struck the rear of Unit 2. Driver of Unit 2 complained of neck pain.",
  "questions": [
   {
    "id": "phone_use",
    "type": "noul",
    "instructions": "The narrative states that a driver was using a phone, such as talking, texting, or reading, at the time of the crash."
   },
   {
    "id": "injury",
    "type": "noul",
    "instructions": "The narrative states that a person was injured or complained of pain."
   }
  ]
 },
 "lab6_construction": {
  "label": "Construction \u00b7 trench",
  "state": "Excavation at Pier 3 is about 8 feet deep with no shoring or trench box. Laborer entered the trench to clear a pump hose. Spoil pile placed at the trench edge. Foreman stopped work and cleared the trench.",
  "questions": [
   {
    "id": "cave_in_hazard",
    "type": "noul",
    "instructions": "Does the report describe a trench cave-in hazard?"
   },
   {
    "id": "work_stopped",
    "type": "noul",
    "instructions": "Was work stopped?"
   }
  ]
 },
 "lab6_bridge": {
  "label": "Bridge \u00b7 inspection",
  "state": "Span 2, girder G3. Diagonal crack about 0.5 mm wide near the east bearing. Rust staining below the deck joint. No section loss observed. Bearing appears frozen.",
  "questions": [
   {
    "id": "site_visit",
    "type": "noul",
    "instructions": "Does the note describe a defect that needs an engineer's site visit before the next routine inspection?"
   },
   {
    "id": "severity",
    "type": "choice",
    "instructions": "How severe is the worst defect described?",
    "criteria": {
     "minor": "Cosmetic or minor, no action needed before the next routine cycle.",
     "moderate": "Needs monitoring or maintenance soon.",
     "severe": "Threatens load capacity or safety and needs prompt action."
    }
   }
  ]
 },
 "lab6_water": {
  "label": "Water \u00b7 main break",
  "state": "Customers on Elm Street report low pressure and brown water since 6 AM. Crew found a 12-inch cast iron main break near hydrant 44. Roadway surface is undermined and sagging in the eastbound lane.",
  "questions": [
   {
    "id": "road_hazard",
    "type": "noul",
    "instructions": "Does the report describe a hazard to traffic on the roadway?"
   },
   {
    "id": "cast_iron",
    "type": "noul",
    "instructions": "Is the broken pipe made of cast iron?"
   }
  ]
 },
 "lab6_fire": {
  "label": "Building \u00b7 fire",
  "state": "Fire started in a second-floor kitchen of a four-story apartment building. Corridor smoke detectors activated. The building has no sprinkler system. Occupants evacuated by stairwell B. One resident treated for smoke inhalation.",
  "questions": [
   {
    "id": "suppression_missing",
    "type": "noul",
    "instructions": "Was a fire suppression system missing or did it fail?"
   },
   {
    "id": "injury",
    "type": "noul",
    "instructions": "Was anyone injured?"
   }
  ]
 }
};
window.RECORDED = {
 "recorded_on": "2026-10-10",
 "runs": {
  "lab0_phone": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 225,
    "answers": {
     "distracted": {
      "p_yes": 0.97,
      "confidence": null
     },
     "weather": {
      "p_yes": 0.32,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 172,
    "answers": {
     "distracted": {
      "p_yes": 0.274,
      "confidence": 0.726
     },
     "weather": {
      "p_yes": 0.7937,
      "confidence": 0.7937
     }
    }
   }
  },
  "lab1_scaffold": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 168,
    "answers": {
     "fall_hazard": {
      "p_yes": 0.99,
      "confidence": null
     },
     "harness_held": {
      "p_yes": 0.91,
      "confidence": null
     },
     "injury": {
      "p_yes": 0.04,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 170,
    "answers": {
     "fall_hazard": {
      "p_yes": 0.2185,
      "confidence": 0.7815
     },
     "harness_held": {
      "p_yes": 0.6084,
      "confidence": 0.6084
     },
     "injury": {
      "p_yes": 0.5463,
      "confidence": 0.5463
     }
    }
   },
   "laya_criteria": {
    "model": "laya",
    "latency_ms": null,
    "answers": {
     "fall_hazard": {
      "p_yes": 0.37
     },
     "harness_held": {
      "p_yes": 0.77
     },
     "injury": {
      "p_yes": 0.65
     }
    }
   }
  },
  "lab2_schema": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 158,
    "answers": {
     "medical_episode": {
      "p_yes": 0.96,
      "confidence": null
     },
     "medical_type": {
      "probs": {
       "seizure": 0.0,
       "loss_of_consciousness": 1.0,
       "diabetic": 0.0,
       "cardiac": 0.0,
       "other": 0.0
      },
      "choice": "loss_of_consciousness",
      "confidence": 1.0
     },
     "witness_cited": {
      "p_yes": 0.97,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 338,
    "answers": {
     "medical_episode": {
      "p_yes": 0.8134,
      "confidence": 0.8134
     },
     "medical_type": {
      "probs": {
       "seizure": 0.0138,
       "loss_of_consciousness": 0.9209,
       "diabetic": 0.0097,
       "cardiac": 0.0205,
       "other": 0.0351
      },
      "choice": "loss_of_consciousness",
      "confidence": 0.7656
     },
     "witness_cited": {
      "p_yes": 0.694,
      "confidence": 0.694
     }
    }
   }
  },
  "lab4_table_vs_narrative": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 152,
    "answers": {
     "phone_use": {
      "p_yes": 0.98,
      "confidence": null
     },
     "injury": {
      "p_yes": 0.98,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 218,
    "answers": {
     "phone_use": {
      "p_yes": 0.5588,
      "confidence": 0.5588
     },
     "injury": {
      "p_yes": 0.7314,
      "confidence": 0.7314
     }
    }
   }
  },
  "lab6_construction": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 172,
    "answers": {
     "cave_in_hazard": {
      "p_yes": 0.93,
      "confidence": null
     },
     "work_stopped": {
      "p_yes": 0.98,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 180,
    "answers": {
     "cave_in_hazard": {
      "p_yes": 0.1636,
      "confidence": 0.8364
     },
     "work_stopped": {
      "p_yes": 0.8955,
      "confidence": 0.8955
     }
    }
   }
  },
  "lab6_bridge": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 158,
    "answers": {
     "site_visit": {
      "p_yes": 0.81,
      "confidence": null
     },
     "severity": {
      "probs": {
       "minor": 0.01,
       "moderate": 0.82,
       "severe": 0.17
      },
      "choice": "moderate",
      "confidence": 0.73
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 204,
    "answers": {
     "site_visit": {
      "p_yes": 0.8122,
      "confidence": 0.8122
     },
     "severity": {
      "probs": {
       "minor": 0.2502,
       "moderate": 0.2155,
       "severe": 0.5343
      },
      "choice": "severe",
      "confidence": 0.0785
     }
    }
   }
  },
  "lab6_water": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 131,
    "answers": {
     "road_hazard": {
      "p_yes": 0.98,
      "confidence": null
     },
     "cast_iron": {
      "p_yes": 0.99,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 180,
    "answers": {
     "road_hazard": {
      "p_yes": 0.1973,
      "confidence": 0.8027
     },
     "cast_iron": {
      "p_yes": 0.9673,
      "confidence": 0.9673
     }
    }
   }
  },
  "lab6_fire": {
   "jev": {
    "model": "jev-1.13.0",
    "latency_ms": 146,
    "answers": {
     "suppression_missing": {
      "p_yes": 0.93,
      "confidence": null
     },
     "injury": {
      "p_yes": 0.96,
      "confidence": null
     }
    }
   },
   "laya": {
    "model": "laya \u00b7 english",
    "latency_ms": 175,
    "answers": {
     "suppression_missing": {
      "p_yes": 0.6199,
      "confidence": 0.6199
     },
     "injury": {
      "p_yes": 0.7501,
      "confidence": 0.7501
     }
    }
   }
  }
 }
};
