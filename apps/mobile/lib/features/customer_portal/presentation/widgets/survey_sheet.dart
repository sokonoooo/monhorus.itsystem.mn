import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../data/models/service_request_model.dart';
import '../../data/models/survey_model.dart';
import '../../domain/entities/survey_enums.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import 'blueprint_ui.dart';
import 'customer_ui.dart';

/// The satisfaction survey, answered one technician at a time.
///
/// The stepper is not a presentation choice. `POST /surveys/requests/:id/responses`
/// takes ONE `employeeId` per call, because the survey exists to say something about a
/// person rather than about a job: a single score for work two people attended cannot
/// be attributed to either of them. So the sheet walks the technicians, posting once
/// each, and the "N / M" counter is the client saying out loud what the API requires.
///
/// The skip — "Би энэ ажилтантай харилцаагүй" — is the other half of that shape and is
/// a product requirement rather than an escape hatch. A customer may be asked about
/// somebody they never met, and a rating invented out of politeness is
/// indistinguishable from an observation once it is inside the average that will be
/// used to judge that person's work. So skipping is offered as an equal, framed choice
/// and it posts `skipped: true` with an EMPTY answers array — the schema refuses the
/// two together, and [SubmitSurveyResponseRequest.skip] is the only way this client can
/// build it.
///
/// Nothing here mentions a promised window, a deadline or an elapsed duration. The
/// customer surfaces of this app carry no SLA at all, and asking somebody to score
/// timeliness against a window they were never shown would be inventing a promise.
///
/// Dependencies arrive through Riverpod: the form and the submit both go through
/// [customerPortalRepositoryProvider], which a test overrides with a fake. That is the
/// same injection point every other portal screen uses; the one dependency
/// [CreateRequestSheet] takes as a constructor argument is the camera, which Riverpod
/// cannot reach.
class SurveySheet extends ConsumerStatefulWidget {
  const SurveySheet({super.key, required this.requestId});

  final String requestId;

  static Future<void> show(BuildContext context, {required String requestId}) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: CustomerTokens.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(CustomerTokens.radiusSheet),
        ),
      ),
      builder: (BuildContext ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: SurveySheet(requestId: requestId),
      ),
    );
  }

  @override
  ConsumerState<SurveySheet> createState() => _SurveySheetState();
}

class _SurveySheetState extends ConsumerState<SurveySheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  /// The form as it stood when the sheet opened.
  ///
  /// Read ONCE rather than watched, and that is deliberate: every successful submit
  /// invalidates [surveyFormProvider] so the screens behind the sheet stop offering
  /// what has just been answered, and a watched sheet would rebuild its own queue out
  /// from under the customer mid-way through it.
  SurveyFormModel? _form;
  bool _loading = true;
  String? _loadError;

  /// The technicians still awaiting an answer, in the order they will be asked about.
  List<SurveyPendingEmployeeModel> _queue = const <SurveyPendingEmployeeModel>[];
  int _index = 0;

  /// The current technician's answers, keyed by question id. Rating answers are `int`,
  /// yes/no `bool`, single-choice the option's stored `value`. Free text lives in
  /// [_textControllers] instead, because a controller is the field's own state.
  final Map<String, Object> _answers = <String, Object>{};
  final Map<String, TextEditingController> _textControllers =
      <String, TextEditingController>{};

  bool _submitting = false;
  String? _submitError;

  /// True once every technician has been answered or skipped.
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _textControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });

    try {
      final SurveyFormModel? form =
          await ref.read(surveyFormProvider(widget.requestId).future);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _form = form;
        _queue = form?.outstandingEmployees ??
            const <SurveyPendingEmployeeModel>[];
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = error is Failure
            ? error.message
            : 'Үнэлгээний асуулга ачаалж чадсангүй.';
      });
    }
  }

  /// The questions this build can draw, already ordered and filtered.
  List<SurveyQuestionModel> get _questions =>
      _form?.answerableQuestions ?? const <SurveyQuestionModel>[];

  SurveyPendingEmployeeModel? get _current =>
      _index < _queue.length ? _queue[_index] : null;

  TextEditingController _controllerFor(String questionId) =>
      _textControllers.putIfAbsent(questionId, () => TextEditingController());

  @override
  Widget build(BuildContext context) {
    if (_loading) return _shell(const _SurveyBusy());
    if (_loadError != null) {
      return _shell(
        CustomerEmptyState(
          icon: Icons.cloud_off_outlined,
          message: _loadError!,
          actionLabel: 'Дахин оролдох',
          onAction: () => unawaited(_load()),
        ),
      );
    }
    if (_finished) return _shell(_buildThanks());

    final SurveyPendingEmployeeModel? employee = _current;
    if (_form == null || employee == null) return _shell(_buildNothingToRate());

    return _buildForm(_form!, employee);
  }

  /// The handle-and-padding chrome every non-form state shares.
  Widget _shell(Widget child) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const SheetHandle(),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: child,
          ),
        ],
      ),
    );
  }

  Widget _buildNothingToRate() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        const CustomerEmptyState(
          icon: Icons.assignment_turned_in_outlined,
          message: 'Энэ хүсэлтэд үнэлэх ажилтан үлдээгүй байна.',
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: () => Navigator.of(context).maybePop(),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('Хаах'),
        ),
      ],
    );
  }

  Widget _buildThanks() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 68,
          height: 68,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: CustomerTokens.greenBg,
            shape: BoxShape.circle,
            border: Border.all(color: CustomerTokens.greenBorder, width: 2),
          ),
          child: const Icon(Icons.check, size: 32, color: CustomerTokens.green),
        ),
        const SizedBox(height: 14),
        Text('Үнэлгээ хүлээн авлаа', style: CustomerTokens.screenTitle),
        const SizedBox(height: 8),
        Text(
          'Таны өгсөн үнэлгээ ажилтан бүрээр бүртгэгдлээ. Үйлчилгээгээ '
          'сайжруулахад тань туслах болно.',
          textAlign: TextAlign.center,
          style: CustomerTokens.emptyText,
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: () => Navigator.of(context).maybePop(),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('Хаах'),
        ),
      ],
    );
  }

  Widget _buildForm(SurveyFormModel form, SurveyPendingEmployeeModel entry) {
    final EmployeeRefModel employee = entry.employee;
    final bool isLast = _index == _queue.length - 1;

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.92,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SheetHandle(),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        'Үйлчилгээний үнэлгээ',
                        style: CustomerTokens.screenTitle,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${form.requestNumber} дуудлагад ажилласан ажилтан бүрийг '
                        'тусад нь үнэлнэ.',
                        style: CustomerTokens.rowSub.copyWith(height: 1.55),
                      ),
                      const SizedBox(height: 14),

                      // The counter says what the API requires: one response per
                      // technician, so the customer knows how many times they will be
                      // asked before they start.
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          const FieldLabel('Ажилтан'),
                          Text(
                            '${_index + 1} / ${_queue.length}',
                            style: CustomerTokens.monoLabel,
                          ),
                        ],
                      ),
                      ProgressRail(
                        fraction: (_index + 1) / _queue.length,
                        color: CustomerTokens.accent,
                      ),
                      const SizedBox(height: 12),

                      _EmployeeCard(employee: employee),
                      const SizedBox(height: 16),

                      for (final SurveyQuestionModel question in _questions)
                        _buildQuestion(question, employee.id),

                      if (_questions.isEmpty)
                        Text(
                          'Энэ асуулгад одоогоор асуулт тохируулаагүй байна.',
                          style: CustomerTokens.rowSub.copyWith(height: 1.45),
                        ),

                      const SizedBox(height: 4),
                      _buildSkipSection(employee),

                      if (_submitError != null) ...<Widget>[
                        const SizedBox(height: 10),
                        NoticeBanner.alert(text: _submitError!),
                      ],
                      const SizedBox(height: 10),
                    ],
                  ),
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              decoration: const BoxDecoration(
                border: Border(top: CustomerTokens.hairlineFaintSide),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).maybePop(),
                      child: const Text('Болих'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      onPressed: _submitting ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(isLast ? 'Илгээх' : 'Дараагийн ажилтан'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The skip, given its own framed panel and its own sentence.
  ///
  /// Drawn as an equal choice rather than as a way out of the form: a customer who
  /// never met this technician has nothing to report, and the honest record of that is
  /// no response at all. Made deliberately hard to hit by accident all the same — it is
  /// an outlined button under an explanation, not a link beside the submit.
  Widget _buildSkipSection(EmployeeRefModel employee) {
    return BlueprintFrame(
      padding: const EdgeInsets.fromLTRB(13, 12, 13, 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const FieldLabel('Эсвэл'),
          Text(
            '${employee.displayName} гэдэг хүнтэй биечлэн харилцаагүй бол '
            'үнэлгээ өгөх шаардлагагүй. Танил бус хүнд оноо өгөхгүй байх нь '
            'зөв хариулт юм.',
            style: CustomerTokens.rowSub.copyWith(height: 1.45),
          ),
          const SizedBox(height: 11),
          OutlinedButton.icon(
            onPressed: _submitting ? null : () => unawaited(_submit(skip: true)),
            icon: const Icon(Icons.person_off_outlined, size: 18),
            label: const Text('Би энэ ажилтантай харилцаагүй'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuestion(SurveyQuestionModel question, String employeeId) {
    // Keyed by technician as well as by question, so moving on to the next person
    // gives every control a fresh state rather than the previous answer's.
    final ValueKey<String> key =
        ValueKey<String>('survey:$employeeId:${question.id}');

    if (question.type == SurveyQuestionType.text) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _QuestionHeader(question: question),
            const SizedBox(height: 8),
            TextFormField(
              key: key,
              controller: _controllerFor(question.id),
              maxLines: 4,
              maxLength: maxSurveyTextAnswer,
              decoration: const InputDecoration(
                hintText: 'Сэтгэгдлээ бичнэ үү',
              ),
              validator: (String? value) {
                if (!question.isRequired) return null;
                return (value?.trim() ?? '').isEmpty
                    ? 'Энэ асуултад заавал хариулна.'
                    : null;
              },
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: FormField<Object>(
        key: key,
        validator: (Object? _) {
          if (!question.isRequired) return null;
          return _answers.containsKey(question.id)
              ? null
              : 'Энэ асуултад заавал хариулна.';
        },
        builder: (FormFieldState<Object> field) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _QuestionHeader(question: question),
              const SizedBox(height: 8),
              switch (question.type) {
                SurveyQuestionType.rating1To5 => _RatingRow(
                    value: _answers[question.id] as int?,
                    onChanged: (int value) => _setAnswer(question.id, value, field),
                  ),
                SurveyQuestionType.yesNo => _YesNoRow(
                    value: _answers[question.id] as bool?,
                    onChanged: (bool value) => _setAnswer(question.id, value, field),
                  ),
                SurveyQuestionType.singleChoice => _ChoiceList(
                    options: question.options,
                    value: _answers[question.id] as String?,
                    onChanged: (String value) =>
                        _setAnswer(question.id, value, field),
                  ),
                // TEXT is handled above, and a null type never reaches here:
                // `answerableQuestions` drops the shapes this build cannot draw.
                _ => const SizedBox.shrink(),
              },
              if (field.hasError) ...<Widget>[
                const SizedBox(height: 6),
                Text(
                  field.errorText!,
                  style: CustomerTokens.rowSub.copyWith(
                    color: CustomerTokens.red,
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  void _setAnswer(String questionId, Object value, FormFieldState<Object> field) {
    setState(() {
      _answers[questionId] = value;
      // A refusal that was about a missing answer is now stale.
      _submitError = null;
    });
    field.didChange(value);
  }

  /// The answers for the technician on screen, one field per answer.
  ///
  /// An unanswered optional question sends nothing at all rather than a null: the
  /// schema wants exactly one value per answer entry, so an empty entry would be a
  /// malformed one.
  List<SubmitSurveyAnswer> _collectAnswers() {
    final List<SubmitSurveyAnswer> answers = <SubmitSurveyAnswer>[];

    for (final SurveyQuestionModel question in _questions) {
      final Object? value = _answers[question.id];
      switch (question.type!) {
        case SurveyQuestionType.rating1To5:
          if (value is int) {
            answers.add(
              SubmitSurveyAnswer.rating(questionId: question.id, value: value),
            );
          }
        case SurveyQuestionType.yesNo:
          if (value is bool) {
            answers.add(
              SubmitSurveyAnswer.boolean(questionId: question.id, value: value),
            );
          }
        case SurveyQuestionType.singleChoice:
          if (value is String && value.isNotEmpty) {
            answers.add(
              SubmitSurveyAnswer.choice(questionId: question.id, value: value),
            );
          }
        case SurveyQuestionType.text:
          final String text = _controllerFor(question.id).text.trim();
          if (text.isNotEmpty) {
            answers.add(
              SubmitSurveyAnswer.text(questionId: question.id, value: text),
            );
          }
      }
    }

    return List<SubmitSurveyAnswer>.unmodifiable(answers);
  }

  /// Posts the technician on screen — either their answers, or the statement that the
  /// customer never dealt with them.
  ///
  /// A skip does NOT validate the form. That is the point of it: a required question
  /// is required of somebody who met the technician, and blocking the skip behind it
  /// would leave a customer with no way through except to invent a score.
  Future<void> _submit({bool skip = false}) async {
    if (_submitting) return;

    final SurveyPendingEmployeeModel? entry = _current;
    if (entry == null) return;

    if (!skip && !(_formKey.currentState?.validate() ?? false)) return;

    final SubmitSurveyResponseRequest request = skip
        ? SubmitSurveyResponseRequest.skip(employeeId: entry.employee.id)
        : SubmitSurveyResponseRequest.rated(
            employeeId: entry.employee.id,
            answers: _collectAnswers(),
          );

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    final ApiResult<void> result = await ref
        .read(customerPortalRepositoryProvider)
        .submitSurveyResponse(widget.requestId, request);

    if (!mounted) return;

    result.when(
      success: (void _) => _advance(),
      failure: (Failure failure) => setState(() {
        _submitting = false;
        _submitError = failure.message;
      }),
    );
  }

  /// Moves on to the next technician, or to the thank-you when there is none.
  ///
  /// Invalidated after EVERY response rather than only at the end, so a customer who
  /// answers one technician and closes the sheet does not come back to a prompt that
  /// still asks about them. The sheet itself is unaffected: it read the form once and
  /// walks a queue of its own.
  void _advance() {
    ref
      ..invalidate(pendingSurveysProvider)
      ..invalidate(surveyFormProvider(widget.requestId))
      ..invalidate(serviceRequestDetailProvider(widget.requestId));

    setState(() {
      _submitting = false;
      _answers.clear();
      for (final TextEditingController controller in _textControllers.values) {
        controller.clear();
      }
      if (_index + 1 >= _queue.length) {
        _finished = true;
      } else {
        _index++;
      }
    });
  }
}

class _SurveyBusy extends StatelessWidget {
  const _SurveyBusy();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(child: CircularProgressIndicator()),
      );
}

/// Who is being rated, said plainly before any question is asked.
class _EmployeeCard extends StatelessWidget {
  const _EmployeeCard({required this.employee});

  final EmployeeRefModel employee;

  @override
  Widget build(BuildContext context) {
    return PanelCard(
      accent: CustomerTokens.accent,
      child: Row(
        children: <Widget>[
          const RowTile(tone: AccentTone.blue, icon: Icons.engineering_outlined),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  employee.displayName,
                  style: CustomerTokens.cardTitle,
                ),
                if (employee.employeeCode.isNotEmpty)
                  Text(employee.employeeCode, style: CustomerTokens.rowSub),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The question's own wording, plus whether an answer is required of it.
class _QuestionHeader extends StatelessWidget {
  const _QuestionHeader({required this.question});

  final SurveyQuestionModel question;

  @override
  Widget build(BuildContext context) {
    final String? help = question.helpText;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          question.isRequired ? '${question.text} *' : question.text,
          style: CustomerTokens.rowTitle.copyWith(
            fontWeight: FontWeight.w700,
            height: 1.35,
          ),
        ),
        if (help != null && help.isNotEmpty) ...<Widget>[
          const SizedBox(height: 3),
          Text(help, style: CustomerTokens.rowSub.copyWith(height: 1.4)),
        ],
      ],
    );
  }
}

/// The 1-5 row, every step carrying the word the shared constant gives it.
///
/// The words are printed rather than left to the star count, because five stars mean
/// different things to different people and `SURVEY_RATING_LABELS` is what the results
/// table will call the same number.
class _RatingRow extends StatelessWidget {
  const _RatingRow({required this.value, required this.onChanged});

  final int? value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        for (int score = surveyRatingMin; score <= surveyRatingMax; score++) ...<Widget>[
          if (score > surveyRatingMin) const SizedBox(width: 5),
          Expanded(
            child: _RatingStep(
              score: score,
              selected: value != null && value! >= score,
              isCurrent: value == score,
              onTap: () => onChanged(score),
            ),
          ),
        ],
      ],
    );
  }
}

class _RatingStep extends StatelessWidget {
  const _RatingStep({
    required this.score,
    required this.selected,
    required this.isCurrent,
    required this.onTap,
  });

  final int score;
  final bool selected;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String label = surveyRatingLabels[score] ?? '$score';

    return Material(
      color: isCurrent ? CustomerTokens.accentBg : CustomerTokens.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 2),
          decoration: BoxDecoration(
            border: Border.all(
              color: isCurrent ? CustomerTokens.ink : CustomerTokens.line,
              width: CustomerTokens.hairline,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                selected ? Icons.star : Icons.star_border,
                size: 22,
                color: selected ? CustomerTokens.yellow : CustomerTokens.muted,
              ),
              const SizedBox(height: 4),
              Text(
                label,
                maxLines: 2,
                textAlign: TextAlign.center,
                style: CustomerTokens.rowSub.copyWith(
                  fontSize: 9.5,
                  height: 1.2,
                  color: isCurrent ? CustomerTokens.ink : CustomerTokens.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _YesNoRow extends StatelessWidget {
  const _YesNoRow({required this.value, required this.onChanged});

  final bool? value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: _ToggleButton(
            label: 'Тийм',
            icon: Icons.check_circle_outline,
            selected: value == true,
            onTap: () => onChanged(true),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _ToggleButton(
            label: 'Үгүй',
            icon: Icons.highlight_off,
            selected: value == false,
            onTap: () => onChanged(false),
          ),
        ),
      ],
    );
  }
}

class _ToggleButton extends StatelessWidget {
  const _ToggleButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? CustomerTokens.ink : CustomerTokens.white,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 11),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? CustomerTokens.ink : CustomerTokens.line,
              width: CustomerTokens.hairline,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                icon,
                size: 17,
                color: selected ? CustomerTokens.white : CustomerTokens.muted,
              ),
              const SizedBox(width: 7),
              Text(
                label,
                style: CustomerTokens.rowTitle.copyWith(
                  color: selected ? CustomerTokens.white : CustomerTokens.ink,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The options of a SINGLE_CHOICE question, one row each.
///
/// What travels on the wire is the option's stored `value`; the label is only what the
/// customer reads. Two options may read alike and still be different answers.
class _ChoiceList extends StatelessWidget {
  const _ChoiceList({
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final List<SurveyQuestionOptionModel> options;
  final String? value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    if (options.isEmpty) {
      return Text(
        'Энэ асуултад сонголт тохируулаагүй байна.',
        style: CustomerTokens.rowSub.copyWith(color: CustomerTokens.red),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final SurveyQuestionOptionModel option in options) ...<Widget>[
          Material(
            color: CustomerTokens.white,
            child: InkWell(
              onTap: () => onChanged(option.value),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: option.value == value
                        ? CustomerTokens.ink
                        : CustomerTokens.line,
                    width: CustomerTokens.hairline,
                  ),
                ),
                child: Row(
                  children: <Widget>[
                    Icon(
                      option.value == value
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      size: 18,
                      color: option.value == value
                          ? CustomerTokens.ink
                          : CustomerTokens.muted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(option.label, style: CustomerTokens.rowTitle),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
        ],
      ],
    );
  }
}
