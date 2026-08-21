import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../domain/entities/object_enums.dart';

/// The controls behind an equipment TYPE's own declared fields (requirements 4.1).
///
/// ONE RENDERER, TWO SCREENS. The Дүгнэлт тайлан sheet asks these questions on a device,
/// and the Дүгнэлт editor asks them per equipment card in the Ажил tab. They have to offer
/// the same controls and read the same way, so they share this rather than each growing
/// their own copy — the same arrangement the web has with `ObjectAttributeFields`.

/// One field of the equipment type's own declared set (requirements 4.1).
///
/// Four kinds, and the control is chosen from the definition rather than from anything
/// this file knows: a SELECT and a BOOLEAN are pickers, a NUMBER and a TEXT are boxes.
///
/// A BOOLEAN IS A PICKER, NOT A SWITCH. A switch has two positions and this question has
/// three — Тийм, Үгүй, and not answered yet — and collapsing that would make a required
/// yes/no satisfiable by a control nobody ever touched.
class ObjectAttributeControl extends StatelessWidget {
  const ObjectAttributeControl({
    required this.attribute,
    required this.controller,
    required this.value,
    required this.enabled,
    required this.error,
    required this.onChanged,
    super.key,
  });

  final ObjectTypeAttributeModel attribute;

  /// Present for the text-backed kinds, null for the pickers.
  final TextEditingController? controller;

  /// The picked option value, for the picker kinds. `''` means unanswered.
  final String value;
  final bool enabled;
  final String? error;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    switch (attribute.type) {
      case ObjectAttributeType.select:
        return _AttributePicker(
          label: attribute.label,
          value: value,
          enabled: enabled,
          error: error,
          onChanged: onChanged,
          options: <_AttributeChoice>[
            for (final ObjectAttributeOptionModel option in attribute.options)
              _AttributeChoice(option.value, option.label),
          ],
        );

      case ObjectAttributeType.boolean:
        return _AttributePicker(
          label: attribute.label,
          value: value,
          enabled: enabled,
          error: error,
          onChanged: onChanged,
          options: const <_AttributeChoice>[
            _AttributeChoice('true', 'Тийм'),
            _AttributeChoice('false', 'Үгүй'),
          ],
        );

      case ObjectAttributeType.number:
        return ObjectAttributeTextField(
          controller: controller,
          value: value,
          onChanged: onChanged,
          hint: 'Тоо',
          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
          error: error,
          enabled: enabled,
        );

      case ObjectAttributeType.text:
        return ObjectAttributeTextField(
          controller: controller,
          value: value,
          onChanged: onChanged,
          hint: attribute.label,
          error: error,
          enabled: enabled,
        );
    }
  }
}

/// One tappable answer on an attribute picker.
class _AttributeChoice {
  const _AttributeChoice(this.value, this.label);

  final String value;
  final String label;
}

/// The pick-one control behind a SELECT or a BOOLEAN attribute.
///
/// Chips rather than a dropdown: these lists are two or three entries long, the sheet is
/// filled in one-handed at a panel, and a chip is a target a gloved thumb can hit. Tapping
/// the chip that is already chosen clears it again, which is the only way to un-answer an
/// optional attribute once something has been tapped.
class _AttributePicker extends StatelessWidget {
  const _AttributePicker({
    required this.label,
    required this.value,
    required this.options,
    required this.enabled,
    required this.error,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<_AttributeChoice> options;
  final bool enabled;
  final String? error;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final _AttributeChoice option in options)
              _AttributeChip(
                label: option.label,
                // The semantics label names the attribute as well as the answer, because a
                // sheet may carry several pickers and "Хайлмалтай" alone does not say which
                // question it belongs to.
                semanticsLabel: '$label: ${option.label}',
                selected: option.value == value,
                enabled: enabled,
                hasError: error != null,
                onTap: () => onChanged(option.value == value ? '' : option.value),
              ),
          ],
        ),
        if (error != null) ObjectAttributeErrorLine(error!),
      ],
    );
  }
}

class _AttributeChip extends StatelessWidget {
  const _AttributeChip({
    required this.label,
    required this.semanticsLabel,
    required this.selected,
    required this.enabled,
    required this.hasError,
    required this.onTap,
  });

  final String label;
  final String semanticsLabel;
  final bool selected;
  final bool enabled;
  final bool hasError;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color border = selected
        ? EmployeeTokens.ink
        : hasError
            ? EmployeeTokens.red
            : EmployeeTokens.line;

    return Semantics(
      button: true,
      selected: selected,
      label: semanticsLabel,
      child: Material(
        color: selected ? EmployeeTokens.ink : EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              border: Border.all(color: border, width: EmployeeTokens.hairline),
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
            ),
            child: Text(
              label,
              style: EmployeeTokens.body.copyWith(
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected
                    ? EmployeeTokens.white
                    : enabled
                        ? EmployeeTokens.ink
                        : EmployeeTokens.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}


/// The refusal printed under an attribute control.
class ObjectAttributeErrorLine extends StatelessWidget {
  const ObjectAttributeErrorLine(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 5),
      child: Text(
        text,
        style: EmployeeTokens.rowSub.copyWith(
          fontWeight: FontWeight.w600,
          color: EmployeeTokens.red,
        ),
      ),
    );
  }
}

/// The box behind a TEXT or NUMBER attribute.
///
/// Takes either a controller (the sheet owns one per attribute, so its text survives the
/// keyboard) or a plain value plus [onChanged] (the conclusion card holds its drafts in the
/// editor's state and rebuilds from them). Whichever is supplied drives the field; a
/// controller wins, because re-seeding one on rebuild fights the cursor.
class ObjectAttributeTextField extends StatelessWidget {
  const ObjectAttributeTextField({
    required this.controller,
    required this.value,
    required this.onChanged,
    required this.hint,
    required this.error,
    required this.enabled,
    this.keyboardType,
    super.key,
  });

  final TextEditingController? controller;
  final String value;
  final ValueChanged<String> onChanged;
  final String hint;
  final String? error;
  final bool enabled;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    final bool hasError = error != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        TextFormField(
          controller: controller,
          initialValue: controller == null ? value : null,
          enabled: enabled,
          keyboardType: keyboardType,
          onChanged: onChanged,
          style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
            filled: true,
            fillColor: hasError ? EmployeeTokens.redBg : EmployeeTokens.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: const BorderSide(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.ink,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
        ),
        if (hasError) ObjectAttributeErrorLine(error!),
      ],
    );
  }
}
