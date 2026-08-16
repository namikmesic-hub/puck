# J'adore Bag Design System

## Overview
A luxury, editorial design system for J'adore Bag — Bangkok's premier luxury bag spa and revitalization service. The aesthetic is cinematic minimalism: vast white canvas, deep emerald tones, and gold accents that elevate every touchpoint to high-fashion standards.

## Colors

- **Cream Base** (#FFFDF7): Global page background, warm neutral canvas — 99% white with a luxury undertone
- **Deep Emerald** (#2E5E4E): Primary brand color, headers, CTAs, nav elements, footer background
- **Emerald Light** (#3A7A66): Hover states, secondary accents
- **Emerald Dark** (#1E3E34): Hero backgrounds, deep sections, dark overlays
- **Soft Gold** (#D4AF37): Accent highlights, overlines, badges, dividers, icons
- **Gold Light** (#E8CC6E): Gold hover states, bright accents
- **Gold Muted** (rgba 15% opacity): Icon backgrounds, subtle tints
- **White** (#FFFFFF): Cards, surfaces, form backgrounds
- **Charcoal** (#1A1A1A): Primary text color
- **Gray** (#6B6B6B): Body text, descriptions
- **Gray Light** (#9A9A9A): Captions, metadata, overlines

## Typography

### Primary Display: Playfair Display
- **Hero**: 5.5rem (clamp 3rem-5.5rem), weight 400, italic for emphasis words
- **Section Titles**: 3rem (clamp 2rem-3rem), weight 400
- **Card Headers**: 1.3rem, weight 500
- **Used for**: All major headings, logo, pricing display, testimonials author names

### Secondary Body: Lato
- **Body Large**: 1rem, weight 400, line-height 1.7
- **Body Small**: 0.88rem, weight 400
- **Labels**: 0.78rem, weight 500, letter-spacing 0.1em, uppercase
- **Buttons**: 0.82rem, weight 700, letter-spacing 0.12em, uppercase
- **Used for**: All body text, form elements, buttons, navigation

### Accent Display: Cormorant Garamond
- **Overlines**: 0.72rem, weight 400, letter-spacing 0.3em, uppercase
- **Badge Text**: 0.72rem, weight 400, letter-spacing 0.2em, uppercase
- **Hero Subtitle**: 1.35rem (clamp), weight 400, line-height 1.7
- **Used for**: Section overlines, hero subtitles, pricing tiers, footer labels

## Spacing
- **Base Unit**: 8px
- **Section Padding**: 140px vertical (desktop), responsive clamp
- **Container Max-Width**: 1280px, centered
- **Container Padding**: clamp(20px, 5vw, 80px) horizontal
- **Card Padding**: 48px 36px (services), 44px 36px (pricing), 40px (testimonials)
- **Grid Gaps**: 32px (service cards), 48px (comparison cards), 28px (pricing), 32px (testimonials)

## Border Radius
- **Pill Buttons**: 999px (all CTAs, nav buttons, price tags, form submit)
- **Cards**: 20px (services), 24px (comparison, pricing, testimonials), 28px (booking form)
- **Form Inputs**: 14px
- **Feature Icons**: 16px (services), 14px (booking features)
- **Avatar/Brand Icons**: 50% (full circle)

## Elevation & Shadows
- **Service Card Hover**: 0 20px 60px rgba(46,94,78,0.08)
- **Comparison Card Hover**: 0 24px 64px rgba(0,0,0,0.06)
- **Testimonial Hover**: 0 16px 48px rgba(0,0,0,0.04)
- **Button Hover**: 0 8px 30px rgba(212,175,55,0.3) for gold, 0 8px 30px rgba(46,94,78,0.2) for emerald
- **Gold Divider Dot**: 0 4px 16px rgba(212,175,55,0.4)

## Component Guidelines

### Navigation
- Fixed position, transparent → cream glass on scroll
- Logo: Playfair Display 1.6rem + Cormorant Garamond overline
- Nav links: Lato 0.82rem uppercase, gold underline on hover
- CTA button: Outlined emerald, fills on hover

### Buttons
- **Primary**: Gold background, emerald-dark text, pill shape
- **Secondary**: Transparent, white border, white text
- **Form Submit**: Emerald background, white text, full width
- **Pricing CTA (outline)**: Transparent, white border (dark bg), gold border on hover

### Cards
- Cream background with subtle emerald border (0.12 opacity)
- Gold-to-emerald gradient top accent line on hover (3px, animated scale)
- Translate-Y lift on hover with shadow transition

### Forms
- Cream background inputs matching page background
- Gold border + gold glow on focus
- Uppercase labels in emerald dark
- Full-width emerald submit button with pill shape

## Animations
- **Hero**: Staggered fade-up entrance (0.3s delay increments)
- **Scroll Reveal**: TranslateY(40px) → 0 with 0.8s cubic-bezier transition
- **Navbar**: Backdrop blur glass effect on scroll (20px blur)
- **Service Card**: Top gradient line scales from 0 to 1 on hover
- **Marquee**: Infinite horizontal scroll, 30s linear loop
- **Hero Glow**: 6s pulse animation on radial gradient orb

## Logo Usage
- Primary: "J'adore Bag" in Playfair Display 1.6rem
- Sub-mark: "Luxury Bag Spa" in Cormorant Garamond, gold, 0.7rem uppercase
- Always displayed vertically stacked

## Image Treatment
- **Hero**: Full-bleed emerald gradient background (no photo required)
- **Before/After**: Split comparison with gold divider line
- **Service Icons**: Emoji on gold-muted rounded square backgrounds
- **Testimonial Avatars**: Gold-muted circle with Playfair initial

## Key Principles
1. **Monochrome + Gold**: Never use fuchsia or bright colors — emerald + gold only
2. **Editorial Whitespace**: Generous padding, breathing room between elements
3. **Typography Hierarchy**: Playfair (display) → Cormorant (accent) → Lato (body)
4. **Gold as Accent Only**: Never use gold for large backgrounds, only highlights
5. **Product Primacy**: If images were added, they should always be the visual focus