$(function () {
  'use strict';

  // Build "On this page" from the h2 headings (giving ids to any that lack one).
  var $list = $('<ul>');
  $('h2').each(function (i) {
    var $h = $(this);
    var label = $.trim($h.text());
    if (!this.id) this.id = 'sec-' + (i + 1);
    $('<li>').append($('<a>').attr('href', '#' + this.id).text(label)).appendTo($list);
  });
  $('#toc').append($('<h3>').text('On this page'), $list);

  // Smooth scroll for in-page links
  $(document).on('click', 'a[href^="#"]', function (e) {
    var $t = $($(this).attr('href'));
    if (!$t.length) return;
    e.preventDefault();
    $('html, body').animate({ scrollTop: $t.offset().top - 12 }, 250);
    history.replaceState(null, '', this.hash);
  });
});
