# Curiosity Mapped Tool Complexity Tiers

## Purpose

Every Curiosity Mapped tool must be assigned a **Content Complexity Tier** before implementation.

The tier determines the minimum required content, explanatory depth, and UI structure for the tool.

The purpose of the tier system is to standardize the Curiosity Mapped experience while allowing simple tools to remain simple and more consequential or conceptually complex tools to receive the educational treatment they require.

**Do not add sections merely to satisfy a template.**

The objective is:

> **Provide exactly as much explanation as the user needs to understand what the tool calculates, how it calculates it, what the result means, and where the result stops being reliable.**

---

# Tier Identifiers

Use exactly one of these identifiers:

* `SIMPLE`
* `MODERATE`
* `DEEP`

These identifiers represent **cognitive complexity**, not mathematical complexity.

---

# Classification Rule

Assign a tool to the **lowest tier that can adequately explain and contextualize its result**.

When uncertain between two tiers, choose the higher tier.

Determine the tier using these questions:

1. Is the calculation straightforward and the result unlikely to be misunderstood?
2. Does the user need to understand multiple variables or relationships to interpret the result?
3. Does the result depend on assumptions, external factors, or meaningful limitations?
4. Is the result commonly misunderstood or mistaken for a more comprehensive measurement?
5. Could a reasonable user make a materially different decision based on the result?
6. Does understanding the result require explaining concepts beyond the calculation itself?

The more "yes" answers, the more likely the tool belongs in `MODERATE` or `DEEP`.

---

# SIMPLE

## Identifier

`SIMPLE`

## Definition

A Simple tool performs a relatively self-contained calculation or transformation where the result is easy to understand and requires little contextual explanation.

The user primarily needs to know:

* what the tool calculates
* what inputs it accepts
* how the result is derived

The calculation should be understandable with a short explanation.

## Minimum Required Sections

Every `SIMPLE` tool must contain:

### 1. Tool Title

Clearly identify the calculation or conversion.

### 2. Brief Description

One or two concise sentences explaining:

* what the tool calculates
* what the result represents
* when someone might use it

### 3. Calculator / Tool Interface

The interactive inputs and output.

### 4. Formula or Method

Show the mathematical formula when one exists.

If the tool is a conversion or transformation rather than a mathematical formula, show the relevant relationship, rule, or method instead.

### 5. Short Explanation

Briefly explain how the calculation works.

The explanation should be understandable without requiring mathematical expertise.

## Optional Sections

Use only when useful:

* Example
* Common input guidance
* Related tools
* Short note about rounding

## Avoid

Do not automatically add:

* charts
* long educational explanations
* extensive FAQs
* lengthy assumptions sections
* detailed factor analysis
* comprehensive misconception sections

A Simple tool should remain simple.

## Canonical Structure

```text
Title
Brief description

Calculator

Formula / Method

How it works

Related tools
```

## Typical Examples

* Percentage Calculator
* Discount Calculator
* Tip Calculator
* Basic Unit Converter
* Age Calculator
* Date Difference Calculator
* Simple Ratio Calculator

---

# MODERATE

## Identifier

`MODERATE`

## Definition

A Moderate tool performs a calculation whose result benefits from understanding multiple parameters, relationships, assumptions, or external factors.

The calculation itself may still be relatively straightforward, but the **meaning of the result requires context**.

A Moderate tool should answer:

> "What did you calculate, how did you calculate it, what do the variables mean, and what factors should I understand before using this result?"

## Required Sections

Every `MODERATE` tool must contain:

### 1. Tool Title

Clearly identify the calculation.

### 2. Description

Explain:

* what the tool calculates
* what the result represents
* what the result can be used for

### 3. Calculator

Interactive inputs and outputs.

### 4. Formula

Display the primary mathematical formula.

Center the formula when appropriate.

### 5. Variables / Parameters

Explicitly identify every variable in the formula.

For each parameter provide:

* symbol
* name
* meaning
* unit
* relationship to the calculation

Example:

```text
P = principal amount
r = periodic interest rate
n = number of periods
```

### 6. How It Works

Explain the calculation in plain language.

The explanation should connect the formula to the user's inputs and output.

### 7. Result Interpretation

Explain what the result actually means.

Do not assume that displaying a number is sufficient.

### 8. Chart or Visualization

Include a chart or visualization when the calculation represents a relationship that can meaningfully be understood visually.

Examples:

* growth over time
* balance over time
* percentage composition
* rate sensitivity
* distribution
* changing one variable against another

Do not add a chart merely because the tool is Moderate.

### 9. Assumptions

Explicitly identify meaningful assumptions made by the calculation.

Distinguish between:

* values provided by the user
* values derived mathematically
* fixed assumptions
* values the tool does not know

### 10. Factors / Considerations

Explain external or contextual factors that can materially affect the real-world interpretation of the result.

The tool must not pretend to account for factors it cannot actually calculate.

## Optional Sections

Use when appropriate:

* Examples
* Sensitivity analysis
* Common misconceptions
* FAQ
* Limitations
* Edge cases
* Related tools
* Comparison tables

## Canonical Structure

```text
Title
Description

Calculator

Formula

Parameters / Variables

How It Works

Result Interpretation

Visualization

Assumptions

Factors / Considerations

Limitations

Related Tools
```

Not every optional section must appear.

## Typical Examples

* Compound Interest Calculator
* Loan Payment Calculator
* Auto Loan Calculator
* Salary / Take-Home Pay Calculator
* Inflation Calculator
* Investment Return Calculator
* Percentage Change Calculator
* Energy Cost Calculator

---

# DEEP

## Identifier

`DEEP`

## Definition

A Deep tool is both an interactive calculator and an educational resource.

Use this tier when the calculation involves significant assumptions, multiple interacting variables, consequential interpretation, common misconceptions, meaningful edge cases, or a substantial gap between the mathematical result and the real-world concept being modeled.

The defining characteristic is:

> **The user needs to understand the model, not merely obtain its output.**

A Deep tool should function as a **field note + interactive tool + educational reference**.

The Mortgage Calculator is the canonical example.

## Required Sections

Every `DEEP` tool must contain the following conceptual areas.

### 1. Title and Introduction

Clearly establish:

* what the tool calculates
* what problem it helps solve
* what it does not attempt to calculate

### 2. Interactive Calculator

Provide the complete interactive experience near the beginning of the page.

The primary result should be easy to find.

### 3. Formula

Display the governing mathematical formula.

Where appropriate, explain each component of the formula.

### 4. Parameters / Variables

For every parameter:

* symbol
* name
* definition
* unit
* role in the formula
* relationship to the output

### 5. Calculation Method

Explain how the formula transforms the inputs into the result.

Use plain language before introducing mathematical detail.

### 6. Result Interpretation

Explain what the calculated number means.

Explicitly distinguish the mathematical result from what a user might casually assume it means.

### 7. Real-World Context

Explain how the calculated result relates to the real-world system being modeled.

Identify important things that exist in reality but are outside the mathematical model.

### 8. Factors

Identify variables or circumstances that can materially change the real-world outcome.

Clearly distinguish:

* factors the calculator models
* factors the calculator does not model
* factors the user could provide if the tool supported them
* factors that cannot reasonably be estimated

### 9. Assumptions

Document the model's assumptions explicitly.

Never hide important assumptions inside the implementation.

### 10. Visualization

Use meaningful visualizations where they improve understanding.

Potential examples:

* relationship between variables
* change over time
* cumulative totals
* composition of payments
* sensitivity to inputs
* distribution
* comparison scenarios

### 11. Detailed Breakdown

Where useful, show the intermediate or component calculations.

The user should be able to understand where the final number came from.

### 12. Scenarios / Sensitivity

When appropriate, demonstrate how changing important inputs changes the result.

Examples:

```text
What happens if the rate increases?
What happens if the term changes?
What happens if the initial amount changes?
```

### 13. Common Misconceptions

Identify things users commonly believe about the calculation that are incorrect or incomplete.

This section is particularly important when the tool's result is easy to misinterpret.

### 14. Limitations

Explicitly state what the calculator does not calculate.

Never imply precision beyond what the model supports.

### 15. Edge Cases

Explain meaningful edge cases, unusual inputs, or circumstances where the standard calculation behaves differently.

### 16. FAQ

Answer the questions a reasonable user would have after seeing the result.

FAQ content should address genuine conceptual questions, not exist merely for SEO.

### 17. Assumptions / Methodology

Provide a concise methodology section documenting the model and important implementation decisions.

### 18. Related Tools / Concepts

Connect the tool to adjacent Curiosity Mapped material.

These relationships are important because Curiosity Mapped should eventually function as a connected map rather than a collection of isolated pages.

## Canonical Structure

```text
Title
Introduction

Interactive Calculator

What This Calculates

Formula

Parameters / Variables

How the Calculation Works

Your Result

Understanding the Result

Real-World Context

Factors

Assumptions

Visualization

Detailed Breakdown

Scenarios / Sensitivity

Common Misconceptions

What This Calculator Does Not Account For

Limitations

FAQ

Methodology / Assumptions

Related Tools
Related Concepts
```

Sections may be reordered when doing so substantially improves comprehension.

## Typical Examples

* Mortgage Calculator
* Retirement Calculator
* Net Worth Calculator
* Tax Calculator
* Cost of Living Calculator
* Home Affordability Calculator
* Debt Payoff Calculator
* Carbon Footprint Calculator
* Energy Consumption / Cost Models
* Complex Financial Models
* Scientific or engineering calculators where interpretation requires substantial context

---

# Cross-Tier Rules

Regardless of tier, every Curiosity Mapped tool must follow these principles.

## 1. Explain the Result

Never assume that producing a number is enough.

The user should understand what the number represents.

## 2. Show the Mathematics When Appropriate

If a mathematical formula governs the calculation, expose it.

Do not hide simple mathematics merely to make the interface look simpler.

## 3. Define Inputs

Users should understand what each input means.

Do not rely solely on labels.

## 4. Do Not Invent Precision

Do not fabricate values for parameters the calculator cannot know.

If an important value is unknown, either:

* ask the user for it
* make the assumption explicit
* omit it from the calculation

## 5. Distinguish Model From Reality

A calculated result is the output of a model.

Do not imply that the model represents every factor in the real-world system.

## 6. Explain Limitations Proportionally

Simple tools need simple limitations.

Deep tools may require extensive limitations.

The amount of explanation should match the complexity of the model.

## 7. Prefer Transparency Over False Simplicity

When there is a meaningful tradeoff between making the tool appear simple and accurately communicating how it works, favor transparency.

## 8. Avoid Educational Padding

Do not add sections simply because the tier contains them.

Every section must answer a question the user reasonably has.

## 9. Use Progressive Disclosure Where Appropriate

Complex information does not necessarily need to be presented all at once.

Use:

* expandable sections
* tabs where appropriate
* concise summaries
* visual hierarchy
* tables
* "learn more" sections

to preserve usability.

## 10. Preserve the Curiosity Mapped Voice

Tools should feel like **field notes that happen to be interactive** rather than generic SaaS calculators.

The tone should be:

* clear
* curious
* precise
* honest
* educational
* restrained

Avoid:

* marketing language
* exaggerated claims
* artificial urgency
* unnecessary gamification
* unexplained jargon

---

# Tier Selection Heuristic

When implementing a new tool, evaluate it against the following:

| Question                       | SIMPLE     | MODERATE  | DEEP                    |
| ------------------------------ | ---------- | --------- | ----------------------- |
| Straightforward calculation?   | Usually    | Sometimes | Rarely                  |
| Few variables?                 | Yes        | Usually   | Often many/interacting  |
| Result easy to interpret?      | Yes        | Usually   | Often no                |
| Formula explanation needed?    | Short      | Detailed  | Detailed                |
| Parameter definitions needed?  | Basic      | Explicit  | Comprehensive           |
| Chart useful?                  | Rarely     | Often     | Usually when applicable |
| Assumptions important?         | Minimal    | Yes       | Critical                |
| External factors important?    | Rarely     | Sometimes | Usually                 |
| Common misconceptions?         | Rarely     | Sometimes | Frequently              |
| Real-world context needed?     | Minimal    | Moderate  | Significant             |
| Consequential decision-making? | Usually no | Sometimes | Often                   |
| Limitations important?         | Minimal    | Yes       | Extensive               |
| FAQ needed?                    | Usually no | Optional  | Usually                 |
| Educational treatment?         | Minimal    | Moderate  | Full                    |

---

# Important Classification Principle

**Mathematical complexity is not the same as cognitive complexity.**

Do not automatically classify a tool as Deep because its formula is mathematically complicated.

Likewise, do not classify a tool as Simple merely because its formula is mathematically simple.

The correct question is:

> **How much does the user need to understand in order to correctly interpret and responsibly use the result?**

That determines the tier.

---

# Canonical Examples

### SIMPLE

**Percentage Calculator**

The user provides a percentage and a number.

The calculation is straightforward.

Required:

```text
Calculator
Formula
Short explanation
```

---

### MODERATE

**Compound Interest Calculator**

The formula is still manageable, but understanding the result benefits from seeing:

* principal
* rate
* compounding frequency
* time
* growth over time
* assumptions

Required:

```text
Calculator
Formula
Variables
Explanation
Result interpretation
Chart
Assumptions
Factors
```

---

### DEEP

**Mortgage Calculator**

A mortgage payment is mathematically calculable, but the number does not represent the complete cost of owning a home.

Users need to understand:

* principal
* interest
* rate
* term
* amortization
* payment composition
* taxes
* insurance
* PMI
* HOA
* APR
* assumptions
* limitations
* changing inputs
* common misconceptions

Therefore:

```text
Calculator
+
Mathematical model
+
Parameter education
+
Result interpretation
+
Real-world context
+
Visualization
+
Sensitivity
+
Misconceptions
+
Limitations
+
FAQ
+
Methodology
```

This is the canonical **DEEP** Curiosity Mapped tool.

---

# Implementation Rule for Claude Code

When creating or modifying a tool:

1. Determine its `Content Complexity Tier`.
2. Record the tier explicitly in the implementation plan or tool metadata.
3. Select the minimum required sections associated with that tier.
4. Add optional sections only when they materially improve understanding.
5. Do not omit a required section without documenting why it does not apply.
6. Use the lowest appropriate tier.
7. If classification is ambiguous, choose the higher tier.
8. Treat the Mortgage Calculator as the canonical example of `DEEP`.
9. Before finalizing, verify that the completed page satisfies its tier requirements.
10. Maintain consistent visual and semantic patterns across tools within the same tier.

**The tier controls scope, not verbosity.**

A Deep tool should be comprehensive because the subject requires it. A Simple tool should remain concise because additional material would create noise.
