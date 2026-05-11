"""Дополнительные тесты для split-логики ячейки (PR devin/parser-fix-v2)."""
from __future__ import annotations

from schedule_parser.parse_schedule import build_lessons_from_cell


def _by_subject(lessons):
    return {l.subject: l for l in lessons}


class TestCellSplit:
    def test_year3_602_fokhioi_tibpsiv(self):
        """3-602: ФОХиОИ (Гайдук) и ТиБПСиВ (Шалатонин) — общая аудитория 129.
        Один блок ДО фикса возвращал 1 lesson с обоими преподами; после — 2 lesson'а."""
        out = build_lessons_from_cell(
            lesson_text='ФОХиОИ\n3ПГ/4ПГ нечет/чет  \nпроф. Гайдук ПИ\n\nТиБПСиВ\n3ПГ/4ПГ чет/нечет \nст.пр. ШалатонинИ.А.',
            room_text='129',
            day=3, pair=3, t_start='12:10', t_end='13:35',
            group_id='y3-g602', year=3,
        )
        subj = _by_subject(out)
        assert 'ФОХиОИ' in subj, f'got subjects: {list(subj)}'
        assert 'ТиБПСиВ' in subj
        assert 'Гайдук' in subj['ФОХиОИ'].teacher
        assert 'Шалатонин' in subj['ТиБПСиВ'].teacher
        assert subj['ФОХиОИ'].rooms == ['129']
        assert subj['ТиБПСиВ'].rooms == ['129']
        assert subj['ФОХиОИ'].subgroup == '3ПГ/4ПГ'

    def test_year3_602_separate_rooms(self):
        """Тот же шаблон с разными аудиториями — block 1 → 129, block 2 → 505."""
        out = build_lessons_from_cell(
            lesson_text='ФОХиОИ\n1ПГ/2ПГ нечет/чет \nпроф. ГайдукП.И.\n\nТиБИВ\n1ПГ/2ПГ чет/нечет \nст.пр. ПолонскийН.В.',
            room_text='\n129\n\n\n\n\n505',
            day=2, pair=1, t_start='09:00', t_end='10:25',
            group_id='y3-g601', year=3,
        )
        subj = _by_subject(out)
        assert subj['ФОХиОИ'].rooms == ['129']
        assert subj['ТиБИВ'].rooms == ['505']

    def test_year3_g4_three_subjects(self):
        """3-4: 3 предмета (ЦОС/ИАД/МОиИО) без blank-line, 3 препода, 3 аудитории."""
        out = build_lessons_from_cell(
            lesson_text='ЦОС\n1ПГ/2ПГ нечет/чет\nст.пр. ПолещукН.Н.\nИАД   \n1ПГ/2ПГ чет/нечет\nст.пр. ИсмайиловаА.С.\nМОиИО \n3ПГ чет\nдоц. ЖевнякО.Г.',
            room_text='\n\n42/K1\n\n\n124-3\n\n\n508',
            day=3, pair=3, t_start='12:10', t_end='13:35',
            group_id='y3-g4', year=3,
        )
        assert len(out) == 3, f'expected 3 lessons, got {len(out)}'
        subj = _by_subject(out)
        assert subj['ЦОС'].teacher == 'ст.пр. ПолещукН.Н.'
        assert subj['ЦОС'].rooms == ['42/K1']
        assert subj['ИАД'].teacher == 'ст.пр. ИсмайиловаА.С.'
        assert subj['ИАД'].rooms == ['124-3']
        assert subj['МОиИО'].teacher == 'доц. ЖевнякО.Г.'
        assert subj['МОиИО'].rooms == ['508']
        # МОиИО is 3ПГ only
        assert subj['МОиИО'].subgroup == '3ПГ'

    def test_year2_english_split_subgroups(self):
        """2-7: Английский с 2 преподами и парой подгрупп '2 ПГ/1 ПГ' — split на 2 lesson'а."""
        out = build_lessons_from_cell(
            lesson_text='Английский язык\n2 ПГ/1 ПГ\nпр.ст. ДингилевскаяМ.А.\nпр. БурковскаяА.И. ',
            room_text='\n137\n\n614',
            day=1, pair=2, t_start='10:35', t_end='12:00',
            group_id='y2-g7', year=2,
        )
        assert len(out) == 2
        # Both have subject 'Английский язык' (no inline teacher pollution)
        for l in out:
            assert l.subject == 'Английский язык'
        # Teachers separated, no '; ' join
        teachers = sorted(l.teacher for l in out)
        assert teachers == ['пр. БурковскаяА.И.', 'пр.ст. ДингилевскаяМ.А.']
        # Subgroups match the '2 ПГ/1 ПГ' sequence: Дингилевская=2ПГ, Бурковская=1ПГ
        by_t = {l.teacher: l for l in out}
        assert by_t['пр.ст. ДингилевскаяМ.А.'].subgroup == '2ПГ'
        assert by_t['пр. БурковскаяА.И.'].subgroup == '1ПГ'
        # Rooms 1-to-1
        assert by_t['пр.ст. ДингилевскаяМ.А.'].rooms == ['137']
        assert by_t['пр. БурковскаяА.И.'].rooms == ['614']

    def test_year2_english_german_back_to_back(self):
        """Английский 1ПГ + Немецкий 2ПГ без blank-line → 2 lesson'а."""
        out = build_lessons_from_cell(
            lesson_text='Английский язык\n1 ПГ\nпр.ст. ГришковецТ.Ю.\n  Немецкий язык\n2 ПГ\nст.пр. БукоВ.П.',
            room_text='705\n135',
            day=4, pair=3, t_start='14:00', t_end='15:25',
            group_id='y2-g10', year=2,
        )
        assert len(out) == 2
        subj = _by_subject(out)
        assert 'Английский язык' in subj
        assert 'Немецкий язык' in subj
        assert subj['Английский язык'].rooms == ['705']
        assert subj['Немецкий язык'].rooms == ['135']
        assert subj['Английский язык'].subgroup == '1ПГ'
        assert subj['Немецкий язык'].subgroup == '2ПГ'

    def test_simple_lesson_unchanged(self):
        """Простая ячейка с одним предметом — без изменений."""
        out = build_lessons_from_cell(
            lesson_text='Физика\n1ПГ/2ПГ\nдоц. ИвановИ.И.',
            room_text='123',
            day=1, pair=1, t_start='09:00', t_end='10:25',
            group_id='y1-g1', year=1,
        )
        assert len(out) == 1
        assert out[0].subject == 'Физика'
        assert out[0].teacher == 'доц. ИвановИ.И.'
        assert out[0].rooms == ['123']

    def test_empty_cell(self):
        out = build_lessons_from_cell(
            lesson_text='', room_text='',
            day=1, pair=1, t_start='09:00', t_end='10:25',
            group_id='y1-g1', year=1,
        )
        assert out == []

    def test_teacher_prefix_pr_dot_recognized(self):
        """'пр. БурковскаяА.И.' — преподаватель, не subject."""
        from schedule_parser.parse_schedule import is_teacher_line
        assert is_teacher_line('пр. БурковскаяА.И.')
        assert is_teacher_line('пр.ст. ДингилевскаяМ.А.')
        assert is_teacher_line('ст.пр. БукоВ.П.')
        assert is_teacher_line('ст. пр. КучукО.А.')
        assert is_teacher_line('доц. ЖевнякО.Г.')
        assert is_teacher_line('асс. ГурскаяЮ.К.')
        assert is_teacher_line('проф. Гайдук ПИ')
        assert not is_teacher_line('Английский язык')
        assert not is_teacher_line('2 ПГ/1 ПГ')
        assert not is_teacher_line('доп.занятие на 11.05')
        assert not is_teacher_line('')

    def test_year3_602_live_format_with_date_note(self):
        """LIVE формат расписания: вместо blank line между блоками стоит дата-нота 'с 16.02'.
        Парсер должен распознать что внутри одной cell — 2 разных предмета и расщепить их по индексу."""
        out = build_lessons_from_cell(
            lesson_text='ФОХиОИ\n3ПГ/4ПГ нечет/чет  \nпроф. Гайдук ПИ\nс 16.02\nТиБПСиВ\n3ПГ/4ПГ чет/нечет \nст.пр. ШалатонинИ.А.',
            room_text='129',
            day=1, pair=3, t_start='12:00', t_end='13:20',
            group_id='y3-g602', year=3,
        )
        assert len(out) == 2, f'expected 2 lessons, got {len(out)}: {[(l.subject, l.teacher) for l in out]}'
        subj = _by_subject(out)
        assert 'ФОХиОИ' in subj, f'subjects: {list(subj)}'
        assert 'ТиБПСиВ' in subj
        assert subj['ФОХиОИ'].teacher == 'проф. Гайдук ПИ'
        assert subj['ТиБПСиВ'].teacher == 'ст.пр. ШалатонинИ.А.'
        assert subj['ФОХиОИ'].subgroup == '3ПГ/4ПГ'
        assert subj['ТиБПСиВ'].subgroup == '3ПГ/4ПГ'
        assert subj['ФОХиОИ'].rooms == ['129']
        assert subj['ТиБПСиВ'].rooms == ['129']

    def test_lesson_ids_unique_when_split(self):
        """После split lesson'ы должны иметь уникальные id (включают teacher/subgroup в хэш)."""
        out = build_lessons_from_cell(
            lesson_text='Английский язык\n2 ПГ/1 ПГ\nпр.ст. ДингилевскаяМ.А.\nпр. БурковскаяА.И. ',
            room_text='\n137\n\n614',
            day=1, pair=2, t_start='10:35', t_end='12:00',
            group_id='y2-g7', year=2,
        )
        ids = {l.id for l in out}
        assert len(ids) == len(out), f'duplicate ids: {[l.id for l in out]}'
